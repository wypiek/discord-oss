# Change your instance's URL

An instance's id is the lowercase host of its address, with the port when it isn't 443, and other instances store it in everything they copied from yours, such as `name@your.id`. This page moves all of that to a new address without losing DMs, servers or friends.

## Before you start

- Keep `federation.key` and `jwt.key`. A new key turns the move into a key change that people have to approve, see [If you lost the key](#if-you-lost-the-key).
- Point the new domain at the server with a certificate.
- If you still control the old domain, keep it pointing at the server for at least a week, because instances that haven't heard of the move keep sending to it.

## Steps

1. Set `general.serverName`, `api.endpointPublic`, `cdn.endpointPublic` and `gateway.endpointPublic` to the new address, in `config.json` or on the Site settings page of the admin dashboard.
2. Add the old id under Previous ids on the Federation page, or to `federation.previousIds`, up to 10 ids.
3. Restart the server. About 10 seconds later it publishes the move statement in `moved_from` of `/.well-known/meowcord` and sends it to every instance it shares anything with, then again every 24 hours. The Instance moves card shows each answer.
4. In a pull request, change your `instances.json` entry's `id` and `url`, add `previous_ids`, and run `bun scripts/instances-md.mjs`. The old id must not keep an entry of its own, or the registry refuses the move:

    ```json
    { "id": "new.example", "name": "Meow", "url": "https://new.example", "source_url": null, "previous_ids": ["old.example"] }
    ```

5. Within an hour of the merge, the registry checks the statement, moves your approval, discovery servers, admin contacts and counts to the new id and publishes the move. Other instances fetch it within 5 minutes.

## What other instances rewrite

Each instance refuses the move when the registry names a different key for the old id than the one it recorded. It then rewrites `@123@old.id` to `@123@new.id` and `name@old.id` to `name@new.id`, and moves mirror servers and channels, group DM members, cached encryption keys, queued events, servers verified for discovery and `federation.peers` to the new id. Blocks are copied to the new id and kept on the old one.

A rewrite that stops halfway continues at the next registry check. A user looked up under the new id before the move arrived exists twice, so the rewrite merges the copies, leaves a deleted account named `moved-<id>` and lists the merge on the Federation page. Old ids keep working, and encrypted messages sent before the move still verify.

## If you lost the key

Follow the steps above and explain what happened in the pull request. A registry admin confirms that you run both addresses and approves the move. Other instances then show it as Needs an admin on their Federation page until their admins press Apply. A statement signed with the old key that names a new key goes through the same approval.

## Limits

- Nobody can move an id that already moved, or move to an id whose recorded key differs from the statement's.
- A move back to an earlier id ends the old alias. Chains of moves are followed for at most 8 hops.
- Bookmarks and invite links keep the old domain, so redirect it if you can.
