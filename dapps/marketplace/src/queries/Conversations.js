import gql from 'graphql-tag'
import fragments from './Fragments'

export default gql`
  query Conversations($limit: Int, $offset: Int) {
    messaging(id: "defaultAccount") {
      id
      enabled
      isKeysLoading
      conversations(limit: $limit, offset: $offset) {
        id
        totalUnread
        lastMessage {
          address
          media {
            url
            contentType
          }
          content
          timestamp
          type
          offer {
            ...basicOfferFields
            listing {
              ...basicListingFields
            }
          }
          eventData {
            offerID
            eventType
          }
        }
      }
      totalUnread
    }
  }
  ${fragments.Listing.basic}
  ${fragments.Offer.basic}
`
