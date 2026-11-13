# Profile banners

A profile banner is an image of up to 10 MiB that shows at the top of the profile popout and the full profile. Every account has Premium, so everyone can set one, static or animated.

## Setting a banner

Discord's profile editor sends `PATCH /users/%40me/profile` with `banner` as a data URI. The `@` in the path is percent-encoded. `PATCH /users/@me` takes `banner` too. A server profile banner goes to `PATCH /guilds/:guild_id/profile/%40me`.

The API stores the image on the CDN at `banners/<user_id>/<hash>`, or `guilds/<guild_id>/users/<user_id>/avatars/<hash>` for a server profile banner, and keeps the hash in `users.banner` or `members.banner`. The hash is the MD5 of the file. An animated GIF, WebP, APNG or AVIF gets the `a_` prefix, which tells the client to ask for the animated version.

A data URI of a 10 MiB image is about 14 MiB of JSON. `src/api/middlewares/ImageUploadLimit.ts` raises the request body limit for the routes that take images. It matches the route after turning `%40` back into `@`, because Express doesn't decode `req.path`. Before that, the profile editor's request kept the default 10 MiB body limit, so banners over about 7.5 MiB failed with 413 while the editor still showed them as a pending change.

## How other people see it

`GET /users/:id/profile` returns the hash in `user.banner`, `user_profile.banner` and, with `guild_id`, `guild_member_profile.banner`. A limited profile for someone who isn't allowed to see the full one keeps the banner, see [profile-privacy.md](profile-privacy.md). The response carries `Cache-Control: private, no-store`, as does `GET /users/:id`, so no browser or proxy cache can hand a viewer an older banner hash after the owner changes it.

Saving a banner sends `USER_UPDATE` to the owner and `GUILD_MEMBER_UPDATE` with the new user object to every server the owner is in, followed by a presence update. Discord's client marks the cached profile stale on `GUILD_MEMBER_UPDATE`, so the next popout or full profile fetches it again and shows the new banner without a reload. A friend who shares no server with the owner gets only the presence update, so their open client keeps the old banner until it reloads.

## Serving it

The client builds `/banners/<user_id>/<hash>.<png|webp|gif>?size=<n>` on the instance's own host, and adds `animated=true` for an animated WebP. The CDN resizes and converts the stored file, see [limits.md](../security/limits.md#images-stickers-and-sounds). A banner that exists is cached for 6 hours, which is safe because a new banner gets a new hash. A missing banner and any CDN error answer with `Cache-Control: no-store`, so a 404 is never kept by a browser or by a proxy in front of the server.

A reverse proxy has to accept the upload body. nginx refuses bodies over 1 MiB unless `client_max_body_size` is raised, see [setup.md](../self-hosting/setup.md#your-own-reverse-proxy).

Replaced banners are deleted 30 seconds after nothing references them, by `src/api/util/handlers/ImageFiles.ts`.
