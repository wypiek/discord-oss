# Pride badges

People pick pride flags in Settings, Profiles, or at signup, and the flags show as badges on their profile. **Pride flags are permanent.** No config key, environment variable, admin setting or plugin setting can hide or disable the badges, the picker or flag picking at signup, and the `FosscordPride` plugin can't be turned off. The catalog never has heterosexual or cisgender flags. `scripts/tests/pride-permanent.test.cjs` enforces this. People can reorder their badges in the Customize Your Badges panel, but the server refuses to hide a pride badge there. To stop showing a flag, unpick it in the picker.

## The catalog

The picker offers 85 flags, all served as local SVGs, so picking or showing a badge makes no external request. 39 come unmodified from [b3yc0d3/twemoji-flags](https://github.com/b3yc0d3/twemoji-flags) at commit `1eee036f2567edc1f56f7dcb4105eae5a347cc7b`, without its heterosexual flag and its template. The other 46 are drawn locally on the upstream template's silhouette.

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

The register form has an optional Pride flags section under the password field. It reads the catalog from `GET /api/v9/auth/pride-badges`, which needs no login and allows 30 requests a minute per IP, so new flags show up without a client change. The chosen slugs are saved on the new account, so the flags are on the profile from the first load. An unknown slug fails registration with a `pride_badges` field error.

## Regenerating and checking

`bun scripts/pride-badge-art.cjs` redraws the local badge images from the pinned originals and the template and updates the supplemental checksums in the manifest. `--check` verifies them without writing. The tests:

```sh
bun test scripts/tests/pride-permanent.test.cjs scripts/tests/pride-badges.test.cjs scripts/tests/pride-badge-art.test.cjs scripts/tests/pride-profile-refresh.test.cjs scripts/tests/signup-pride-badges.test.cjs
```

The browser check `ORIGIN=http://localhost:<port> bun scripts/dev/pride-badges-smoke.mjs` loads every image on a seeded dev server and checks saving, clearing, search, friend updates and admin-assigned badges.
