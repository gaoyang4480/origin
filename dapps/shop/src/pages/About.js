import React from 'react'

import Link from 'components/Link'

const About = () => (
  <>
    <div className="collection">
      <div className="breadcrumbs">
        <Link to="/">Home</Link>
        <span>About</span>
      </div>
      <div className="d-flex flex-row justify-content-between align-items-center">
        <h3>About</h3>
      </div>
    </div>
    <div className="about-page">
      <div className="question">What is this site?</div>
      <div className="answer">
        This is a decentralized e-commerce site leveraging Ethereum, IPFS, ENS
        and PGP. All content is hosted on IPFS. Payments can be made with Eth,
        Dai or Credit Card.
      </div>
      <div className="question">Who built this?</div>
      <div className="answer">
        This site was built by{' '}
        <a href="https://www.originprotocol.com">Origin Protocol</a>, whose
        mission it is to bring about decentralized, peer to peer marketplaces.
        It is 100% open source and available on{' '}
        <a href="https://github.com/OriginProtocol/origin">GitHub</a>.
      </div>
      <div className="question">
        How do I deploy my own decentralized e-commerce store?
      </div>
      <div className="answer">
        For now, please fill out the contact form on this{' '}
        <a href="https://medium.com/originprotocol/built-on-origin-a-decentralized-shopify-alternative-888adc4198b0">
          blog post
        </a>{' '}
        to be notified when the decentralized store is generally available.
      </div>
    </div>
  </>
)

export default About

require('react-styl')(`
  .about-page
    max-width: 600px
    a
      text-decoration: underline
    .question
      font-weight: bold
    .answer
      margin-bottom: 1rem
`)
