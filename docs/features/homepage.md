# Homepage and loading screen

The instance's own pages outside the client are the homepage at `/`, the link previews for it and for invites, and the loading screen the client shows while it starts. All of them read the configuration on each request, so a change shows up on the next page load without a restart.

## Homepage

The homepage is laid out like Discord's: a night sky with the instance logo, links to the page's sections, the [blog and help centre](blog-and-help.md), Status, Developers, Guidelines and Privacy, and an "Open <name>" button that opens the client. The hero has a large headline, the tagline and a drawing of the client on a monitor and a phone with the instance icon. Below it are "Create an account" and "Open <name> in your browser", or "Sign in" when registration is closed. Then come 4 feature sections, a FAQ of 7 questions, a closing call to action and a footer that links to `/blog`, `/support`, `/status`, `/developers`, `/terms`, `/privacy` and `/guidelines` and keeps the Discord OSS credit. There's no download button and nothing for sale.

The header and footer show `client.logo` when it is set, and otherwise the instance icon and name. The header and footer are the same as on the blog. The header is 80 px tall with the links centred on the page, and below 1101 px the links move into a menu button that opens a blurple panel from the right. The footer has the logo and the Discord OSS credit on the left, 3 columns of links on the right, and the instance name drawn across the full width at the bottom, or `client.logo` when it is set.

The page uses the fonts of the cached client: ABC Ginto Discord Nord for headlines, ABC Ginto Discord for the header, footer, tagline and buttons, and gg sans inside the drawing of the client. The sizes follow discord.com: a 56 px headline at 1906 px wide, a 20 px tagline and 64 px tall buttons with 12 px corners.

| Setting                                              | Effect                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `client.instanceName`, `client.icon`, `client.logo`  | The name, icon and logo throughout the page.                                   |
| `general.instanceDescription`                        | Replaces the default tagline and the page's meta description.                  |
| `register.disabled`, `register.allowNewRegistration` | Either one closes registration, and the page then says new accounts are closed. |
| `register.requireInvite`                             | The page explains that joining needs an invite link.                           |
| `general.correspondenceEmail`                        | Adds a Contact link to the footer and the address to the FAQ.                  |

## Link previews

The homepage and every `/invite/<code>` page carry Open Graph and Twitter Card tags, so other sites and chat apps show a card instead of a bare URL. The homepage card uses the instance name, `general.instanceDescription` and the app icon. An invite card names the server and the instance and shows the server's description or member count and its icon. An unknown or expired invite gets the homepage card, so the page doesn't reveal whether a code ever existed.

`/api/v9/oembed?url=<page>` answers oEmbed requests for pages on the same host.

## Loading screen

Under Site settings, Loading screen, an operator enters one "Did you know?" tip per line and pastes a loading animation as an SVG. The client picks a random tip on each start, and empty fields restore the built-in tips and animation.

| Key                  | Limit                                                 |
| -------------------- | ----------------------------------------------------- |
| `client.loadingTips` | Up to 100 tips of 500 characters each.                |
| `client.loadingSvg`  | Up to 64 KB, 1,000 elements and 64 levels of nesting. |

The SVG may use drawing elements, gradients, local references, CSS and SVG animation. The server refuses scripts, event handlers, embedded HTML and external resources with HTTP 400 and keeps the old configuration.
