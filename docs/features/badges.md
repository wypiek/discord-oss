# Badges

Profiles show the badges Discord's client knows, with Discord's artwork, levels and rarity, plus the instance's own badges. Pride flags are not badges: they show with the pronouns, see [pride-badges.md](pride-badges.md). Clicking a badge or picking Badges in the profile menu opens the badge directory ("Your badges"), which the server fills from `GET /users/<id>/badges`.

## Levelled badges

| Badge | Levels | Counts |
| --- | --- | --- |
| Account Age | 10, Seed (1 year) to Primordial (10+ years) | Whole years since the account was created. Every account has it once it is a year old. |
| Streaming | 10, Newcomer (1 hour) to Phenomenon (5,000+ hours) | Hours spent streaming with Go Live while at least one other person watches. |
| Game Time | 10, Casual (1 hour) to Eternal (5,000+ hours) | Hours with a game in the user's activity. |
| Game Variety | 10, Sampler (2 games) to Universalist (100+ games) | Different games played, counted by application id or game name, up to 200. |
| Features (Discord's Nitro badge) | 9, Starter to Opal (6+ years) | Months since a start date an admin sets. Nobody has it unless an admin gives it. |

Admins can set any of these to any level for a user, see [Admin controls](#admin-controls).

Streaming, Game Time and Game Variety only count for users who turned on activity-based personalisation in Privacy settings, like on Discord. The gateway checks every connected session once a minute and the voice server checks every stream once a minute. Each check adds 60 seconds, so a user with two devices playing is counted once. The totals, the games and the time each level was first reached are kept in the `user_activity_stats` table. Leaving personalisation off keeps the progress already earned.

The directory shows the current level, the next one, a progress bar with Discord's helper text such as "55 more hours" or "7 more months", every level with its unlock date, and the rarity of the current level. Your own directory also lists levelled badges you haven't reached yet. Other people's directories only list the badges they own.

## Discord's legacy badges

The admin dashboard's Discord presets (Staff, Partner, Moderator Programs Alumni, HypeSquad Events and the three HypeSquad houses, Bug Hunter, Golden Bug Hunter, Early Verified Bot Developer and Early Supporter) are recognised by their icon and shown with Discord's large artwork, the MYTHIC pill (RARE for the houses), a flavour line such as "Professional lurker" and an "Unlocked by" text. The texts use the instance name where Discord's say Discord. Staff and staff role badges show first unless the user moves them, and users can hide them like any other badge. The Active Developer preset is not seeded: a migration removes it from instances where nobody holds it, and admins can still create it from the Discord presets on the Badges page.

Members of a moderator staff role get Moderator Programs Alumni instead of the staff badge, with Discord's artwork, "Officially certified" and "Unlocked by completing the <instance name> Moderator Program.", and the `CERTIFIED_MODERATOR` public flag. Members of other staff roles with the badge switch on get the staff badge named after their highest such role. See [admin.md](admin.md#role-badges) for which roles count as moderator roles.

When an admin adds the `PARTNERED` feature flag to a server, its owner gets the Partner badge and the `PARTNERED_SERVER_OWNER` user flag right away, and so does anyone who later becomes owner of a partnered server. Removing the flag or transferring the server doesn't take the badge away, as on Discord. Admins can still remove it from the user's badges.

## Beta Tester

Every instance has a Beta Tester badge with id `1000`, seeded by a migration with the test tube icon in `assets/badge-icons/beta_tester.png`, Mythic rarity and the text "Unlocked by being a <instance name> Beta Tester". Give it to users like any other badge on their admin page.

Custom badges have an optional "Unlocked by" text, set on the Badges page, which the badge directory shows under the badge. `{instance}` in it becomes the instance name. Badges without it show their tooltip text there.

## The Void

The Void is modelled on Discord's tiered badge of the same name, which levels up when people spend Orbs. Here only instance staff give it: nobody can claim, buy or level it up themselves, and no Orb amount shows anywhere. It has 10 levels, Eclipse, Stardust, Meteorite, Comet, Pulsar, Quasar, Aurora, Nebula, Nova and Supernova. Eclipse and Stardust are Common, Meteorite to Pulsar Rare, Quasar to Nebula Epic and Nova and Supernova Mythic.

Staff grant a level, change it or take the badge away on the user's admin page, see [Admin controls](#admin-controls). The grant is stored in the user's `badge_overrides` as `the_void`, with the level, the date of the first grant and the date the current level was set. Changing the level keeps the first grant date, and removing the badge deletes both.

The profile lists it with the id `the_void` and the current level, for example "The Void: Supernova". The badge directory shows "The Void" with the level name, the date the current level was set, the level's rarity, "Granted by <instance name> staff." and the 10 levels with their icons. Levels up to the current one are unlocked, the current one says "Current level", and higher ones show a lock. Your own directory also shows the next level, with no progress bar, because only staff can raise it.

The artwork is our own: a ring of three tapering arcs around an empty centre, drawn as SVG in `assets/public/badges/void/<level>.svg`, from cool grey for Eclipse through blues, teal, green, violet and magenta to an orange to pink gradient for Supernova. Each level also has a 128 pixel PNG next to it, because Android's Fresco can't draw SVG. The CDN serves both at `/badge-icons/the_void_<level>.png` and `.svg`. Profiles use the PNG and the directory uses the SVG with the PNG as its raster fallback.

## Orbs Apprentice

Your own directory lists Orbs Apprentice with "Go to Orbs Shop and unlock this badge" and a button to the Orbs Shop, where it is free. Claiming it adds the Orbs Apprentice preset to the account.

## Admin controls

In the admin dashboard, a user's page has a "Badge levels and rarity" card:

- **Features badge (Nitro):** pick a level. The server stores a start date that many months back, so the badge keeps levelling up from there. "No Features badge" takes it away. `PATCH /admin/users/<id>/badge-overrides` also takes `nitro_since` as a date.
- **Levels:** set Account Age, Streaming, Game Time or Game Variety to any level. Account Age then counts from a start date that many years back, and the other three count from the chosen level on top of the user's real progress, so all of them keep levelling up. Every level reached through an override shows the date it was set. "Real progress" removes the override. `PATCH /admin/users/<id>/badge-overrides` takes these as `levels`, for example `{"levels": {"19": "star"}}`.
- **The Void:** pick one of the 10 levels to grant it or change its level, or "No Void badge" to take it away. `PATCH /admin/users/<id>/badge-overrides` takes it as `void_tier`, a level key such as `"nova"` or `null`, and answers with `void_tier`, `void_granted_at`, `void_tier_set_at` and the list of levels. Any other key is refused with HTTP 400. Each change writes a staff audit entry whose `the_void` change holds the old and new level names, and sends `USER_UPDATE`, a member update and a presence update, so open profiles show the new level without a reload.
- **Rarity:** pick Common, Rare, Epic or Mythic for any badge the user has, or Default to go back to the badge's own rarity. Common shows no pill.

Custom badges on the Badges page have their own rarity, which applies to everyone who has them unless a user override says otherwise. Changes need the `MANAGE_USERS` right for users and `OPERATOR` for badges, and every user change is in the staff audit log.

## Artwork

The classic Nitro tenure icon names (`premium_tenure_6_month_v2` and so on, and the Starter icon) redirect to the current Nitro badge art for the same level, so profiles show the coloured Nitro logo rather than the old gems. Apart from The Void, all artwork comes from Discord's CDN through the instance's `/content-assets/<file>` and `/badge-icons/<hash>.png` routes, which download each file once, store it and serve it with a sandboxing Content-Security-Policy. The list of levels, texts and artwork lives in `src/util/util/BadgeCatalog.ts`, generated from a capture of Discord's own badge directory. The Void's levels and texts live in `src/util/util/VoidBadge.ts`.

## Profile badges

The profile's `badges` list uses Discord's badge ids (`staff`, `partner`, `account_age`, `premium_tenure_6_month_v2` and so on, plus `the_void`, which the client maps to the directory entry of the same id), so the client links each profile badge to its directory entry. Badge order and hidden badges from Customize Your Badges are stored under the directory's ids. Settings saved before this change, under the badge row ids, are translated when read.
