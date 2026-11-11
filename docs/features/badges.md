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

## Beta Tester

Every instance has a Beta Tester badge with id `1000`, seeded by a migration with the test tube icon in `assets/badge-icons/beta_tester.png`, Mythic rarity and the text "Unlocked by being a <instance name> Beta Tester". Give it to users like any other badge on their admin page.

Custom badges have an optional "Unlocked by" text, set on the Badges page, which the badge directory shows under the badge. `{instance}` in it becomes the instance name. Badges without it show their tooltip text there.

## Orbs Apprentice

Your own directory lists Orbs Apprentice with "Go to Orbs Shop and unlock this badge" and a button to the Orbs Shop, where it is free. Claiming it adds the Orbs Apprentice preset to the account.

## Admin controls

In the admin dashboard, a user's page has a "Badge levels and rarity" card:

- **Features badge (Nitro):** pick a level. The server stores a start date that many months back, so the badge keeps levelling up from there. "No Features badge" takes it away. `PATCH /admin/users/<id>/badge-overrides` also takes `nitro_since` as a date.
- **Levels:** set Account Age, Streaming, Game Time or Game Variety to any level. Account Age then counts from a start date that many years back, and the other three count from the chosen level on top of the user's real progress, so all of them keep levelling up. Every level reached through an override shows the date it was set. "Real progress" removes the override. `PATCH /admin/users/<id>/badge-overrides` takes these as `levels`, for example `{"levels": {"19": "star"}}`.
- **Rarity:** pick Common, Rare, Epic or Mythic for any badge the user has, or Default to go back to the badge's own rarity. Common shows no pill.

Custom badges on the Badges page have their own rarity, which applies to everyone who has them unless a user override says otherwise. Changes need the `MANAGE_USERS` right for users and `OPERATOR` for badges, and every user change is in the staff audit log.

## Artwork

The classic Nitro tenure icon names (`premium_tenure_6_month_v2` and so on, and the Starter icon) redirect to the current Nitro badge art for the same level, so profiles show the coloured Nitro logo rather than the old gems. All artwork comes from Discord's CDN through the instance's `/content-assets/<file>` and `/badge-icons/<hash>.png` routes, which download each file once, store it and serve it with a sandboxing Content-Security-Policy. The list of levels, texts and artwork lives in `src/util/util/BadgeCatalog.ts`, generated from a capture of Discord's own badge directory.

## Profile badges

The profile's `badges` list uses Discord's badge ids (`staff`, `partner`, `account_age`, `premium_tenure_6_month_v2` and so on), so the client links each profile badge to its directory entry. Badge order and hidden badges from Customize Your Badges are stored under the directory's ids. Settings saved before this change, under the badge row ids, are translated when read.
