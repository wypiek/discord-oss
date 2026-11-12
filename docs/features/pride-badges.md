# Pride badges

People pick pride flags in the profile editor, from the Pride Flags tile in its sidebar, or at signup, and the flags show right after their display name. **Pride flags are permanent.** No config key, environment variable, admin setting or plugin setting can hide or disable the flags, the picker or flag picking at signup, and the `FosscordPride` plugin can't be turned off. The catalog never has heterosexual or cisgender flags. `scripts/tests/pride-permanent.test.cjs` enforces this. To stop showing a flag, unpick it in the picker.

## Where flags show

Flags show with the pronouns, on the line under the display name in profile popouts, the DM profile panel and full profiles, after the pronouns text when there is one. A user with flags but no pronouns gets the line too, with only the flags. They keep the order the user picked them in. Each flag is drawn at the size of a custom emoji next to text and has the flag name as its alt text and tooltip. The line shows at most 8 items. When a user picked more, the last item is a "+N" counter whose tooltip names every flag the user picked. Message headers, the member list and the DM list show no flags.

Flags are not profile badges. They don't appear in the badge row, the badge directory or the Customize Your Badges panel.

## How flags reach the client

`users.pride_badges` holds the picked slugs in order and is part of the public user object, so every user object the server sends carries it: READY, guild members and member list updates, message authors, profiles, DM recipients and relationships. An account with no flags sends `[]`. When a user or an admin changes the flags, the server sends `GUILD_MEMBER_UPDATE` to the user's servers and `PRESENCE_UPDATE` to the user, their friends, their servers and their DM partners, each with the new `pride_badges`. The picker also updates your own user in the client after a save, so the flags change without a reload.

The client keeps the selection on its user record as `prideBadges`, through the patches described in [client-patches.md](../development/client-patches.md#pride-flags-after-the-display-name). It loads the catalog from `GET /api/v9/auth/pride-badges` once, the first time a user with flags is drawn, to get each flag's name and image. A slug the catalog doesn't know is skipped.

## The catalog

The picker offers 85 flags, all served as local SVGs, so picking or showing a flag makes no external request. 39 come unmodified from [b3yc0d3/twemoji-flags](https://github.com/b3yc0d3/twemoji-flags) at commit `1eee036f2567edc1f56f7dcb4105eae5a347cc7b`, without its heterosexual flag and its template. The other 46 are drawn locally on the upstream template's silhouette.

`assets/badge-icons/twemoji-flags/manifest.json` records every file with its slug and SHA-256 checksum. The graphics are CC BY 4.0, and the picker and [ATTRIBUTION.md](../../assets/badge-icons/twemoji-flags/ATTRIBUTION.md) credit them.

Badge IDs run from `8000000000000000001` to `8000000000000000086`. `8000000000000000043` belonged to the removed heterosexual flag and is never reused. A new flag takes the next ID and goes at the end of `src/api/util/utility/prideBadges.ts`, and a shipped slug or ID never changes. A stored selection the catalog doesn't know is returned unchanged to its owner, and saving an unknown slug fails validation.

## Supplemental flags

Ten supplemental flags keep selections that predate the upstream snapshot: rainbow, the original eight-stripe rainbow, Philadelphia, intersex-inclusive Progress, seven-stripe lesbian, five-stripe gay men, gray-asexual, grayromantic, unlabeled and androgyne. Their colors follow [Gilbert Baker](https://gilbertbaker.com/rainbow-flag-origin-story/), [Valentino Vecchietti](https://www.intersexequality.com/intersex-inclusive-progress-pride-flag/), [AUREA](https://www.aromanticism.org/en/resources-1), [AVEN](https://wiki.asexuality.org/w/index.php?title=Asexual_flag) and [Microsoft's pride flag references](https://github.com/microsoft/Pride).

The other 36 follow the lead flag on each term's [LGBTQIA+ Wiki](https://lgbtqia.wiki) page, with colors sampled from it and shapes redrawn by hand, so no wiki artwork is copied or traced. Romantic flags built on a sexuality flag reuse that flag's colors at half strength with a full-color heart in the middle. The manifest's `supplementalSlugs` lists them all.

Where a term has competing flags:

- Bigender uses fireprincette's flag, which the wiki calls the most common, instead of the older seven-stripe flag whose creator is disputed.
- Hijra uses the Tumblr user Samir's 2018 flag. The wiki notes that hijra communities organize under the transgender and rainbow flags and that the flag's creator is not hijra.
- Gender questioning uses enbygsrd's flag for questioning gender instead of the general questioning flag.
- Two-spirit uses the feathers on the rainbow, the design the wiki lists with the most institutional use.

## Picking flags at signup

The register form has an optional Pride flags section under the password field. It reads the catalog from `GET /api/v9/auth/pride-badges`, which needs no login and allows 30 requests a minute per IP, so new flags show up without a client change. The chosen slugs are saved on the new account, so the flags show after the name from the first load. An unknown slug fails registration with a `pride_badges` field error.

## Regenerating and checking

`bun scripts/pride-badge-art.cjs` redraws the local badge images from the pinned originals and the template and updates the supplemental checksums in the manifest. `--check` verifies them without writing. The tests:

```sh
bun test scripts/tests/pride-permanent.test.cjs scripts/tests/pride-badges.test.cjs scripts/tests/pride-badge-art.test.cjs scripts/tests/pride-flags.test.cjs scripts/tests/signup-pride-badges.test.cjs
```

The browser check `ORIGIN=http://localhost:<port> bun scripts/dev/pride-badges-smoke.mjs` selects every flag on a seeded dev server, checks that none of them become profile badges, that a friend sees the first 7 flags and a "+78" counter after the name without reloading, and checks clearing, search and that admin-assigned badges stay.
