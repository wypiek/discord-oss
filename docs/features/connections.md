# Connections

People link accounts from other services in User Settings, Connections, and choose whether each one shows on their profile. The client offers a provider when `GET /api/v9/connections` reports it as enabled, which happens when all three of these are true:

- `externalRequests.thirdParty` is on, see [external-services.md](../self-hosting/external-services.md).
- The provider is turned on.
- The provider has the credentials it needs.

## Setting up providers

Open the admin dashboard, Site settings, Connected accounts. The top of the card turns third-party connections on or off and sets the public address used in callback URLs. Each provider has a switch, its credentials, the callback URL to register with the provider with a Copy button, and a link to the provider's developer page. Secrets are never sent back to the dashboard, only whether one is set. The dashboard refuses to turn a provider on before its required credentials are filled in. A save takes effect at once in the process that served it. When the API runs in several processes, restart the others.

The settings live in the `connection_config` table as one row per `<provider>_<setting>` key, such as `roblox_clientId`, holding a JSON value. The older OAuth providers throw at startup when they are turned on without credentials, so prefer the dashboard over editing the table.

Callback URLs are `<origin>/connections/<provider>/callback`. The origin is the first of these that gives an `http` or `https` URL: `api.connectionsOrigin`, which the card's public address field sets, `api.endpointPublic`, `general.serverName` with `https://` added when it has no scheme, and `general.frontPage`. The homepage URL comes last because it is only a link on the status page and can point to another site. The card shows which address is in use and warns when it is missing, local or not `https`, since most providers only accept `https` redirect URLs.

| Provider | Credentials | On by default | Notes |
| --- | --- | --- | --- |
| Domain | None | Yes | Verified with a DNS record or a file on the website. |
| Steam | None, an optional Web API key | Yes | OpenID 2.0. |
| Bluesky | None | Yes | AT Protocol OAuth. Needs the instance on a public `https` address. |
| Roblox | Client ID and secret | No | OAuth 2.0 with OpenID Connect. |
| Bungie.net | Client ID, secret and API key | No | OAuth 2.0. |
| Battle.net, Discord, Epic Games, Facebook, GitHub, Reddit, Spotify, Twitch, X, Xbox, YouTube | Client ID and secret | No | OAuth 2.0. |

### Domain

1. In User Settings, Connections, the person picks Domain and enters a domain such as `example.dev`.
2. The client sends `POST /api/v9/users/@me/connections/domain/<domain>` with an empty body.
3. If the domain is already verified, the server answers 200 with the connection. Otherwise it answers 400 with the verification code in `proof`, and the client shows it.
4. The person adds a TXT record named `_discord.<domain>` with the code as its value, or serves the code as the whole body of `https://<domain>/.well-known/discord`.
5. Verify sends the same request again. On success the server creates a verified `domain` connection named after the domain, sends `USER_CONNECTIONS_UPDATE` and answers 200.

The code is `dh=` followed by 40 hex digits, an HMAC-SHA256 of the account ID and the domain keyed with the instance's token signing key. The same account always gets the same code for the same domain, other accounts get different codes, and rotating the signing key changes every code.

The server looks up the TXT record with a 4 second timeout and 2 tries. If that fails it fetches the well-known file through `PUBLIC_FETCH_PROXY`, without following redirects, with a 5 second timeout and a 4 KiB limit. When the instance itself is served over `http`, the client shows an `http://` file address, so the server also tries `http` after `https`. Any line of the file may hold the code.

Domains are lowercased, a trailing dot is dropped and internationalized names are converted to their `xn--` form. The server refuses IP addresses, names with a scheme, path, port, `@` or underscore, labels longer than 63 characters, names longer than 253 characters, single-label names and names under `localhost`, `local`, `internal`, `lan`, `home`, `corp`, `test`, `example`, `invalid`, `onion`, `alt`, `arpa` and the `example.com`, `example.net` and `example.org` domains.

| Error code | When | Message |
| --- | --- | --- |
| `DOMAIN_INVALID` | The domain is malformed, too long or an IP address. | Enter a domain name like example.com, without http:// or a path. |
| `DOMAIN_RESERVED` | The domain only exists on private networks. | This domain only works on private networks, so it can't be verified. Use a public domain. |
| `DOMAIN_VERIFICATION_FAILED` | No record or file was found. | We couldn't find a TXT record at `_discord.<domain>` or a file at `<file URL>`. New records can take a few minutes to show up. |
| `DOMAIN_VERIFICATION_FAILED` | A record or file holds a different code. | The record we found for `<domain>` doesn't match. Set its value to `<code>` exactly, then check again. |
| `DOMAIN_LOOKUP_FAILED` | The domain's DNS servers timed out or failed. | We couldn't look up `<domain>` right now. Make sure its DNS servers are answering, then try again in a few minutes. |
| `DOMAIN_CONNECTIONS_DISABLED` | Domain is turned off or `thirdParty` is off. | Domain verification is turned off on this server. |

Each account can make 10 domain checks a minute, set in `limits.rate.routes.domainConnection`. Removing the connection in the client sends `DELETE /api/v9/users/@me/connections/domain/<domain>`.

### Steam

Steam needs no app registration. The server sends people to Steam's OpenID 2.0 sign in page with the callback URL, holding a one-time state, as `openid.return_to` and the instance origin as `openid.realm`. When Steam sends them back, the server checks that the response is signed, comes from `https://steamcommunity.com/openid/login`, names a `https://steamcommunity.com/openid/id/<steamid64>` identity, returns to the callback with the same state and is less than 10 minutes old. It then asks Steam to confirm the signature with `check_authentication` and stores the steamid64.

The connection is named after the Steam persona name. With a Web API key from [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) the server reads it from `GetPlayerSummaries`, otherwise from the public profile at `https://steamcommunity.com/profiles/<steamid64>/?xml=1`. A private profile without a key shows the steamid64.

### Bluesky

Bluesky needs no app registration. The client asks for a handle such as `example.bsky.social` and sends it to `GET /api/v9/connections/bluesky/authorize?handle=<handle>`. The server then:

1. Resolves the handle to a DID through the `_atproto.<handle>` TXT record or `https://<handle>/.well-known/atproto-did`.
2. Reads the DID document from `plc.directory` or, for `did:web`, from the domain, and finds the account's PDS.
3. Finds the PDS's authorization server and sends it a pushed authorization request with PKCE, a DPoP key made for this sign in, the `atproto` scope and the handle as a login hint.
4. Returns the authorization server's sign in page.

After sign in the server exchanges the code with the same DPoP key, checks that the `iss` the client passed back is that authorization server, and checks that the DID in the token is hosted by a PDS that uses the same authorization server. The connection stores the DID and is named after the handle when the handle resolves back to the same DID, otherwise after the DID. The server keeps no Bluesky tokens.

Authorization servers fetch the instance's client metadata from `<api.endpointPublic>/connections/bluesky/client-metadata.json`, or `<origin>/api/v9/connections/bluesky/client-metadata.json` when `api.endpointPublic` isn't `https`, so the instance needs a public `https` address. An instance on `localhost` or `127.0.0.1` uses an AT Protocol loopback client instead, with the callback on `http://127.0.0.1:<port>`, which is enough for development.

### Roblox

1. Open [create.roblox.com/dashboard/credentials](https://create.roblox.com/dashboard/credentials) and create an OAuth 2.0 app.
2. Add the callback URL from the dashboard as a redirect URL and allow the `openid` and `profile` scopes.
3. Paste the client ID and secret into the dashboard and turn Roblox on.

The connection stores the Roblox user ID and is named after the username.

### Bungie.net

1. Open [bungie.net/en/Application](https://www.bungie.net/en/Application) and create an application.
2. Set the OAuth client type to Confidential and the redirect URL to the callback URL from the dashboard. Bungie only accepts `https` redirect URLs.
3. Paste the OAuth client ID, the OAuth client secret and the API key into the dashboard and turn Bungie.net on.

The connection stores the Bungie.net membership ID and is named after the Bungie Name, such as `Guardian#0042`.

### Discord

1. Open [discord.com/developers/applications](https://discord.com/developers/applications) and create an application.
2. Under OAuth2, add the callback URL from the dashboard as a redirect.
3. Paste the client ID and client secret into the dashboard and turn Discord on.

Discord's own client has no Discord entry in its list of connection platforms, so the `FosscordConnections` plugin adds one at the front of the list. The entry uses the instance icon from `/favicon.svg`, and a connected account links to `https://discord.com/users/<id>`. `assets/client_patches/71-connections.js` still hides it when the server reports Discord as off. The client's callback page only runs for types in its own platform enum, so the plugin also lets it accept the types the plugin adds. Without that, `/connections/discord/callback` stays blank and never calls the server. A linked account is named by its username, with `#<discriminator>` only for legacy accounts that still have one.

### GitHub

1. Open [github.com/settings/developers](https://github.com/settings/developers) and create an OAuth app.
2. Set the authorization callback URL to the callback URL from the dashboard.
3. Paste the client ID and a client secret into the dashboard and turn GitHub on.

The server exchanges the code with the secret in the request body, never in the URL. When GitHub refuses the code it logs GitHub's error code, such as `bad_verification_code` or `redirect_uri_mismatch`, and the popup shows the error page. The connection stores the GitHub user ID and is named after the login.

## How the client completes a sign in

1. `GET /api/v9/connections/<provider>/authorize` returns the provider's sign in URL and the client opens it in a popup.
2. The provider sends the popup to `/connections/<provider>/callback` on the instance.
3. The callback page first tries `POST /api/v9/connections/<provider>/callback/session-handoff`, which answers 404 with code 10020 because the instance doesn't hand sessions between browsers. The page then sends the code, the state, Steam's `openid.*` fields and Bluesky's `iss` to `POST /api/v9/connections/<provider>/callback`.
4. The server creates the connection with Display on profile turned on, sends `USER_CONNECTIONS_UPDATE` and answers 204.

Each sign in state can be used once and expires after 15 minutes.

## Providers the client can't offer

The cached client lists TikTok, Mastodon, Instagram, Skype, Samsung Galaxy and Meta Quest but marks them as unavailable, so it never offers them. Riot Games, League of Legends and PlayStation Network only give OAuth access to approved partners. PayPal, eBay, Crunchyroll and Amazon Music aren't implemented.
