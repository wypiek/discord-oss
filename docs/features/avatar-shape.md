# Avatar shape

People pick how round their avatar's corners are, from Discord's circle to a square, in Settings, Profiles, under Avatar. Everyone sees that shape wherever the avatar shows, so a square frame or decoration lines up with the picture under it.

## What the server stores

`users.avatar_corner_radius` is an integer from 0 to 50, a percentage of the avatar's width. 50 is a circle, 0 is a square and `null` means the default circle. `PATCH /users/@me` takes `avatar_corner_radius`, and anything that isn't a whole number from 0 to 50 or `null` fails with a `400` and the field error `AVATAR_CORNER_RADIUS_INVALID`. The client saves 50 as `null`.

Every public user object carries the field when it is set: message authors, members, presences and READY, profiles, DM recipients, voice states and relationship users. Public objects leave it out when it is `null`, so a client without the plugin sees Discord's shape. The owner's own user object always has it, `null` included. `GUILD_MEMBER_UPDATE` and `PRESENCE_UPDATE` after a profile change send `null` explicitly so clients drop a cleared shape.

The migrations `1793528461307-AvatarCornerRadius` add the nullable column to Postgres and SQLite.

## Federation

The `profile` sent with a join or a relay carries `avatar_corner_radius`, and the receiver stores it on the shadow account. A receiver keeps only a whole number from 0 to 50 and reads anything else as `null`, both on shadows and on user objects it caps in remote messages and profiles. A profile fetched from the home instance shows the value the home sends. A shadow takes profile changes from relays at most once a minute, like the other profile fields, so a changed shape can take up to a minute to reach other instances' message authors and member lists.

## The client

The `FosscordAvatarShape` plugin in `client/plugins/fosscordAvatarShape` does all of the drawing and can't be turned off.

- The settings section has a preview at 80, 40 and 32 pixels with status dots, four presets (Circle 50, Rounded 30, Soft square 16 and Square 0), a slider in steps of 1 and a Save avatar shape button.
- The user record gets `avatarCornerRadius` from the payload. The avatar URL builders append `#meowcord-avatar-radius-<n>` to user and member avatar URLs, and a stylesheet rounds any image or background with that fragment. That covers avatars Discord draws as a plain `img` from those URLs, such as reply previews and the autocomplete list.
- Avatars drawn through Discord's SVG masks get a copy of the mask with the circle replaced by a rounded rectangle and the status cutout kept, so the status dot sits at the corner of a square avatar. Animated and speaking avatars get the same change in their inline mask.
- The banner in profile popouts, the profile panel and full profiles gets a mask with a rounded-rectangle hole in place of the circular one, so the ring around the avatar follows its shape.

Not covered: the mobile bundle for Discord's Android app draws circles, and group DM icons and server icons keep their own shapes because they are not user avatars.
