# Instance discovery

`GET /.well-known/discord-oss` describes an instance to a client that connects to it, such as a native client with an instance switcher. It needs no login, answers with `Access-Control-Allow-Origin: *`, can be cached for 5 minutes and shares the `/.well-known` rate limit of 60 requests per 30 seconds per IP address.

A client that is given a domain fetches `https://<domain>/.well-known/discord-oss`, checks that `software.name` is `discord-oss` and that it supports `protocol`, then uses the URLs in the response instead of building its own. All URLs are absolute.

```json
{
    "software": { "name": "discord-oss", "version": "0.1.0-alpha.1" },
    "protocol": 1,
    "instance": {
        "id": "1570103005980680252",
        "name": "Example Chat",
        "description": "Chat, voice and encrypted DMs with your friends. Every feature is free.",
        "url": "https://chat.example.org",
        "icon": "https://chat.example.org/static/logo.png?v=d650df3e",
        "logo": null,
        "theme_color": "#3BA3E8",
        "contact_email": null
    },
    "api": { "url": "https://chat.example.org/api", "default_version": "9", "versions": ["6", "7", "8", "9"] },
    "gateway": { "url": "wss://chat.example.org", "encodings": ["json", "etf"], "compression": ["zlib-stream", "zstd-stream"] },
    "cdn": { "url": "https://chat.example.org" },
    "voice": { "dave": true, "regions": [{ "id": "spacebar", "name": "spacebar", "endpoint": "chat.example.org/voice", "default": true }] },
    "registration": {
        "open": true,
        "invite_required": false,
        "approval_required": false,
        "email_required": false,
        "minimum_age": 13,
        "join_reason": null,
        "captcha": { "service": "cap", "sitekey": "fosscord", "endpoint": "https://chat.example.org/api/v9/auth/cap/" }
    },
    "e2ee": { "protocol": 1, "direct_messages": true },
    "links": {
        "status": "https://chat.example.org/status",
        "support": "https://chat.example.org/support",
        "blog": "https://chat.example.org/blog",
        "terms": "https://chat.example.org/terms",
        "privacy": "https://chat.example.org/privacy",
        "guidelines": "https://chat.example.org/guidelines",
        "developers": "https://chat.example.org/developers"
    }
}
```

| Field | Meaning |
| --- | --- |
| `protocol` | Version of this response's shape. It goes up only when a field changes meaning or is removed. New fields can appear in any version. |
| `instance.id` | A snowflake that stays the same for the life of the instance, even when its domain changes. Use it to key stored accounts. |
| `instance.icon` | The square icon set in `client.icon` or `general.image`, or the default icon rendered at 512 by 512 pixels. |
| `instance.logo` | The wordmark set in `client.logo`, or `null`. |
| `api.url` | Append `/v<version>`, such as `https://chat.example.org/api/v9`. It comes from `api.endpointPublic`, or the request's origin when that isn't set. |
| `gateway.url` | Connect with `?v=9&encoding=json`, from `gateway.endpointPublic` or the request's origin. |
| `voice.regions` | The voice regions from the `regions` config. The gateway sends the endpoint to use in `VOICE_SERVER_UPDATE`, so a client only needs this list to show region names. |
| `registration.open` | `false` when `register.disabled` is on or `register.allowNewRegistration` is off. A registration token from an admin still works then. |
| `registration.captcha` | `null` when signup needs no captcha. Otherwise solve a [Cap](https://capjs.js.org) challenge at `endpoint` and send the token as `captcha_key` with the registration. |
| `e2ee.protocol` | Version of the encryption protocol in [e2ee-protocol.md](e2ee-protocol.md). DMs and group DMs are always encrypted. |
| `links.support` | `client.helpUrl` when it is set, otherwise the instance's own help centre. |

`/.well-known/spacebar/client` still answers for Spacebar clients, with the API, CDN and gateway URLs only.
