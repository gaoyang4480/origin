require('dotenv').config()
const config = require('./config')

const WebSocket = require('ws')
const openpgp = require('openpgp')
const Web3 = require('web3')
const get = require('lodash/get')

const { Network, Transactions, Orders } = require('./data/db')
const abi = require('./utils/_abi')
const { getIpfsHashFromBytes32, getText } = require('./utils/_ipfs')
const sendMail = require('./utils/emailer')

const localContract = process.env.MARKETPLACE_CONTRACT
const PrivateKeyPass = process.env.PGP_PRIVATE_KEY_PASS
const PrivateKey = process.env.PGP_PRIVATE_KEY.startsWith('--')
  ? process.env.PGP_PRIVATE_KEY
  : Buffer.from(process.env.PGP_PRIVATE_KEY, 'base64').toString('ascii')

const web3 = new Web3()
const Marketplace = new web3.eth.Contract(abi)
const MarketplaceABI = Marketplace._jsonInterface

const SubscribeToNewHeads = JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'eth_subscribe',
  params: ['newHeads']
})

const SubscribeToLogs = ({ address, listingId }) => {
  const listingTopic = web3.utils.padLeft(web3.utils.numberToHex(listingId), 64)
  console.log('SubscribeToLogs', { address, listingTopic })
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_subscribe',
    params: ['logs', { address, topics: [null, null, listingTopic] }]
  })
}

const GetPastLogs = ({ fromBlock, toBlock, listingId }) => {
  const listingTopic = web3.utils.padLeft(web3.utils.numberToHex(listingId), 64)
  const rpc = {
    jsonrpc: '2.0',
    id: 3,
    method: 'eth_getLogs',
    params: [
      {
        address: config.marketplace,
        topics: [null, null, listingTopic],
        fromBlock: web3.utils.numberToHex(fromBlock),
        toBlock: web3.utils.numberToHex(toBlock)
      }
    ]
  }
  return JSON.stringify(rpc)
}

const netId = config.network
let ws

async function connectWS() {
  let lastBlock
  const siteConfig = await config.getSiteConfig()
  web3.setProvider(siteConfig.provider)
  const listingId = siteConfig.listingId.split('-')[2]
  console.log(`Connecting to ${siteConfig.provider} (netId ${netId})`)
  console.log(`Watching listing ${siteConfig.listingId}`)
  const res = await Network.findOne({ where: { network_id: netId } })
  if (res) {
    lastBlock = res.last_block
    console.log(`Last recorded block: ${lastBlock}`)
  } else {
    console.log('No recorded block found')
  }

  if (ws) {
    ws.removeAllListeners()
  }

  console.log('Trying to connect...')
  ws = new WebSocket(siteConfig.provider)

  function heartbeat() {
    console.log('Got ping...')
    clearTimeout(this.pingTimeout)
    this.pingTimeout = setTimeout(() => {
      console.log('ping timeout')
      ws.terminate()
      connectWS()
    }, 30000 + 1000)
  }
  ws.heartbeat = heartbeat

  ws.on('error', err => {
    console.log('Error')
    console.error(err)
    setTimeout(() => connectWS(), 5000)
  })
  ws.on('ping', heartbeat)
  ws.on('close', function clear() {
    console.log('Connection closed')
    clearTimeout(this.pingTimeout)
  })

  ws.on('open', function open() {
    console.log('Connection open')
    this.heartbeat()
    ws.send(
      SubscribeToLogs({
        address: siteConfig.marketplaceContract || localContract,
        listingId
      })
    )
    ws.send(SubscribeToNewHeads)
  })

  const handled = {}
  let heads, logs
  ws.on('message', function incoming(raw) {
    const hash = web3.utils.sha3(raw)
    if (handled[hash]) {
      console.log('Ignoring repeated ws message')
    }
    handled[hash] = true

    const data = JSON.parse(raw)
    if (data.id === 1) {
      logs = data.result
    } else if (data.id === 2) {
      heads = data.result
    } else if (data.id === 3) {
      console.log(`Got ${data.result.length} unhandled logs`)
      data.result.map(handleLog)
    } else if (get(data, 'params.subscription') === logs) {
      handleLog(data.params.result)
    } else if (get(data, 'params.subscription') === heads) {
      const number = handleNewHead(data.params.result)
      const blockDiff = number - lastBlock
      if (blockDiff > 500) {
        console.log('Too many new blocks. Skip past log fetch.')
      } else if (blockDiff > 1 && config.fetchPastLogs) {
        console.log(`Fetching ${blockDiff} past logs...`)
        ws.send(
          GetPastLogs({ fromBlock: lastBlock, toBlock: number, listingId })
        )
      }
      lastBlock = number
    } else {
      console.log('Unknown message')
    }
  })
}

const handleNewHead = head => {
  const number = web3.utils.hexToNumber(head.number)
  const timestamp = web3.utils.hexToNumber(head.timestamp)
  console.log(`New block ${number} timestamp: ${timestamp}`)

  Network.upsert({ network_id: netId, last_block: number })

  return number
}

const handleLog = async ({ data, topics, transactionHash, blockNumber }) => {
  const siteConfig = await config.getSiteConfig()
  const eventAbi = MarketplaceABI.find(i => i.signature === topics[0])
  if (!eventAbi) {
    console.log('Unknown event')
    return
  }
  console.log('fetch existing...', transactionHash)
  const existingTx = await Transactions.findOne({
    where: { transaction_hash: transactionHash }
  })
  console.log('existing', existingTx)
  if (existingTx) {
    console.log('Already handled tx')
    return
  } else {
    Transactions.create({
      network_id: netId,
      transaction_hash: transactionHash,
      block_number: web3.utils.hexToNumber(blockNumber)
    }).then(res => {
      console.log(`Created tx ${res.dataValues.id}`)
    })
  }

  const { name, inputs } = eventAbi
  const decoded = web3.eth.abi.decodeLog(inputs, data, topics.slice(1))
  const { offerID, ipfsHash, party } = decoded

  console.log(`${name} - ${siteConfig.listingId}-${offerID} by ${party}`)
  console.log(`IPFS Hash: ${getIpfsHashFromBytes32(ipfsHash)}`)

  try {
    const offerData = await getText(siteConfig.ipfsGateway, ipfsHash, 10000)
    const offer = JSON.parse(offerData)
    console.log('Offer:', offer)

    if (!offer.encryptedData) {
      console.log('No encrypted data found')
      return
    }

    const encryptedDataJson = await getText(
      siteConfig.ipfsGateway,
      offer.encryptedData,
      10000
    )
    const encryptedData = JSON.parse(encryptedDataJson)
    console.log('Encrypted Data:', encryptedData)

    const privateKey = await openpgp.key.readArmored(PrivateKey)
    const privateKeyObj = privateKey.keys[0]
    await privateKeyObj.decrypt(PrivateKeyPass)

    const message = await openpgp.message.readArmored(encryptedData.data)
    const options = { message, privateKeys: [privateKeyObj] }

    const plaintext = await openpgp.decrypt(options)
    const cart = JSON.parse(plaintext.data)
    cart.offerId = `${siteConfig.listingId}-${offerID}`
    cart.tx = transactionHash

    console.log(cart)

    Orders.create({
      order_id: cart.offerId,
      network_id: netId,
      data: JSON.stringify(cart)
    }).then(() => {
      console.log('Saved to DB OK')
    })

    sendMail(cart)
  } catch (e) {
    console.error(e)
  }
}

connectWS()
