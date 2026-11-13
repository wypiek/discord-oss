# Profile privacy

Discord added a Private profile setting in its August 11, 2026 update. People who aren't allowed to see your full profile get a limited one, with a Private Profile label and the note "tester's profile is private, so some info is hidden. Add them as a friend to see more."

## The setting

Settings, Data & Privacy, Profile Privacy, Share my full profile with. The page is Discord's own and isn't behind an experiment.

| Option | Who sees the full profile |
| --- | --- |
| Friends & All Servers | Everyone. This is the default, and an unset value means the same. |
| Friends & Small Servers Only | Friends, and anyone who shares a server of 200 or fewer members with you. |
| Friends Only | Friends. |

The client stores the choice in the protobuf user settings, `privacy.profile_visibility`, field 32 of `PrivacySettings`, with the values 0 unset, 1 friends only, 2 friends and small servers, and 3 friends and all servers. It saves through `PATCH /users/@me/settings-proto/1` like every other protobuf setting, so the server has no column for it and reads it from `user_settings_protos`.

You always see your own full profile, and so does anyone with the `VIEW_USERS` or `OPERATOR` instance right, the rights that already open user records in the admin dashboard.

Friends & All Servers keeps the full profile visible to people who share no server with you, as profiles were before the setting existed. A server counts as small by its `member_count`.

## What the limited profile hides

`GET /users/:id/profile` builds the full response and then blanks it in `limitedProfile` in `src/api/util/utility/profileVisibility.ts` for a viewer who doesn't qualify. The response then has `private: true`, which is the field Discord's client reads to show the label and the note.

| Field | Limited value |
| --- | --- |
| `user.bio`, `user_profile.bio`, `user_profile.pronouns` | `""` |
| `guild_member_profile.bio`, `guild_member_profile.pronouns` | `""` |
| `badges`, `guild_badges` | `[]` |
| `connected_accounts` | `[]` |
| `widgets` | `[]` |
| `premium_since`, `premium_guild_since` | `null` |

That is the list [docs.discord.food](https://docs.discord.food/resources/user#get-user-profile) gives for private profiles, plus the widgets and the server profile's bio and pronouns. The name, avatar, banner, colours, profile effect, frame, server tag, pride flags, mutual servers and mutual friends stay, because Discord's limited profile shows them too. Pride flags stay on every profile, see [pride-badges.md](pride-badges.md).

The routes below follow the same rule.

| Route | For a viewer who doesn't qualify |
| --- | --- |
| `GET /users/:id/badges` | `{ "badges": [] }` |
| `GET /users/:id/badges/:badge_id` | 404 Unknown badge |
| `GET /users/:id/application-identities` | `{ "identities": [] }` |

## Bio and pronouns elsewhere

User objects in messages, member lists, relationships, `GET /users/:id` and gateway events no longer carry `bio` or `pronouns`. Discord's user objects don't either, and the client only reads them from the profile response. Your own user object, in `READY`, `GET /users/@me` and `USER_UPDATE`, still has both.

Member objects keep their server profile `bio` and `pronouns`, and only members of that server receive them. The client doesn't show them from there, only from the profile response, which blanks them.

Activities and presence aren't part of the setting. Discord's client offers to change Activity Privacy for the affected servers after you change it, and that works as before.

## Tests

`scripts/tests/profile-privacy.test.cjs` covers the rules for every setting, the 200 member limit, friends, staff, the fields the limited profile blanks and the routes that check the viewer.
