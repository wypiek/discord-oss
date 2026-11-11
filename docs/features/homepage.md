# Homepage and loading screen

The instance's own pages outside the client are the homepage at `/`, the link previews for it and for invites, and the loading screen the client shows while it starts. All of them read the configuration on each request, so a change shows up on the next page load without a restart.

## Homepage

The homepage has the instance icon and name, a tagline, sign-up and sign-in buttons, 4 feature highlights and a FAQ of 7 questions. The footer links to `/status`, `/terms`, `/privacy` and `/guidelines` and keeps the Meowcord credit.

| Setting                                              | Effect                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `client.instanceName`, `client.icon`                 | The name and icon throughout the page.                                         |
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
