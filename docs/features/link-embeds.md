# Link embeds

When a message has links in its content, the server builds embeds for them after the message is sent and delivers them with a `MESSAGE_UPDATE`. Embeds need `externalRequests.thirdParty` and a working `PUBLIC_FETCH_PROXY`, which [external-services.md](../self-hosting/external-services.md) describes along with the outside hosts involved. The server fetches pages and media through cors.estrogen.delivery, except KLIPY pages, and clients load embed media from it too. Each fetch is capped at `limits.message.maxEmbedDownloadSize`, see [limits.md](../security/limits.md).

| Link                                    | Embed                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube, Vimeo, Dailymotion             | A video that opens the site's player in an iframe.                                                                                                                                      |
| A direct video file                     | A video played from the proxy, with its first frame as the thumbnail.                                                                                                                   |
| A page whose `og:video` is a video file | That video, with the page's `og:image` as thumbnail.                                                                                                                                    |
| GIPHY, Tenor, KLIPY                     | A looping GIF video.                                                                                                                                                                    |
| X and Twitter posts                     | The text, author, reply, repost and like counts, and the first photo or video at up to 2.5 Mbps. With `external.twitter` set, the server uses the official API instead of FixTweet. |
| An image file                           | The image with its size.                                                                                                                                                                |
| Other pages                             | A card from the page's Open Graph tags.                                                                                                                                                 |

The server only passes player URLs from `youtube.com/embed/`, `youtube-nocookie.com/embed/`, `player.vimeo.com/video/` and `dailymotion.com/embed/video/` to clients. It plays any other video URL through the proxy, so a bot can't make the client frame an arbitrary page. A Twitch link stays a plain link card.

## Components media

Messages with the `IS_COMPONENTS_V2` flag carry media in thumbnails, media galleries and file components. A file component must point at an uploaded attachment with `attachment://`, as on Discord, while thumbnails and gallery items can also use any public URL.

After the message is sent, the server reads the type and size of each remote URL with a HEAD request and sends a `MESSAGE_UPDATE`. With `externalRequests.thirdParty` off, it guesses the type from the file extension. The server never copies remote component media into its own storage. Clients load remote images through cors.estrogen.delivery and remote videos through the instance's `/external` proxy.
