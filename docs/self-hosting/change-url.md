# Change your instance's URL

An instance's id is the lowercase host of its address, with the port when it isn't 443.

## Before you start

- Keep `jwt.key` and `jwt.key.pub`, or everyone is signed out.
- Point the new domain at the server with a certificate.

## Steps

1. Set `general.serverName`, `api.endpointPublic`, `cdn.endpointPublic` and `gateway.endpointPublic` to the new address, in `config.json` or on the Site settings page of the admin dashboard.
2. Restart the server.
3. If your instance is in `instances.json`, change its entry's `id` and `url` in a pull request and run `bun scripts/instances-md.mjs`.

## Limits

- Bookmarks, invite links and links in old messages keep the old domain, so redirect it to the new one if you can.
