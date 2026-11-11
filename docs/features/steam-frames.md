# Steam avatar frames

Every instance's Shop has a Steam category with the avatar frames from the Steam Points Shop, 2158 of them from 723 games as of October 21, 2026. They are free like everything else in the Shop and people wear them as avatar decorations.

## The catalogue

`assets/steam-frames.json` is committed and holds metadata only: each frame's definition id, app id, name, description, the file names of its animated and still art, whether it is animated and when Steam created it, plus the game names. It is about 510 KB. `bun scripts/steam-frames.mjs` rebuilds it from Steam's public Web API, which needs no key:

- `ILoyaltyRewardsService/QueryRewardItems` with `community_item_classes[0]=14`, the avatar frame class, 1000 items a page and its cursor. That takes 3 requests.
- `IStoreBrowseService/GetItems` for the game names, 100 apps a request, 8 requests for 737 apps. Apps the store no longer lists keep no name and show as "Steam".

The script waits a second between requests, stops after 10 pages and 30 name batches, keeps only active frames whose art names are 40 hex characters, drops the frames listed in its `EXCLUDED_FRAMES` with the reason for each, sorts the frames by definition id and writes one frame per line, so a refresh shows up as a readable diff. It exits with code 1 and keeps the file when Steam returns no frames. Pass a path to write somewhere else.

`src/util/util/SteamFrames.ts` loads the file once. A frame's SKU is `8000000000000000000` plus its definition id, so every instance gives a frame the same SKU, and that range stays above every snowflake made before 2075. Its asset is the MD5 of its app id and art names, with the `a_` prefix when it is animated, which is the shape Discord's decoration assets have. The category's SKU is `8000000000000000000`. The search tab sorts the frames by the date Steam created them rather than by SKU. The category comes after the custom packs and Discord's packs, and the admin dashboard can hide, rename and reorder it like any mirrored pack. Hiding it keeps the frames people already wear.

## Art

The client asks for decoration art at `/media/v1/collectibles-shop/<sku>/animated` and `/static`. For a Steam SKU the CDN fetches the art once from `https://shared.fastly.steamstatic.com/community_assets/images/items/<app id>/<file>` and keeps it in storage under `steam-frames/<asset>/<slot>`. `/avatar-decoration-presets/<asset>.png` serves the same files, the still one with `passthrough=false`. The fetch goes through `PUBLIC_FETCH_PROXY`, like link previews, and is limited to 10 MiB. `externalRequests.steamAssetFallback`, on by default like `discordAssetFallback`, allows it, and the External requests card on the admin dashboard has its switch. With it off, frames that aren't cached show without art. The Cloudflare Worker CDN does not serve Steam art.

The animated art is an APNG and the still art is a PNG, both 224 pixels square. The client shows the still art and plays the animation on hover where it does so for Discord's decorations, because the asset starts with `a_`. Twenty-one frames have only one image and never animate. Two frames list a `.gif` and two a `.jpg` animation, but all four files are APNGs with an alpha channel, and the CDN sends the type it detects from the bytes.

## Excluded frames

An audit on October 21, 2026 downloaded the still art of 184 frames, every 16th frame of the catalogue plus every frame whose animation isn't a `.png` and the E.Z frames, and the animation of 85 of them. It measured how much of each image is opaque, how much of that is near black, and how much of the avatar's middle it covers. Seven other sampled frames are drawn more than 90% in near black or dark red, such as ivy, ink, fog and blood, and they read as frames on the dark theme, so they stay. The four frames from E.Z, Squishy, Shadowlike, Mechanism and Pumping, are flat black blocks with no other color. Mechanism's and Pumping's still art covers 35% and 32% of the avatar, and the Shop showed all four as black rectangles, so the generator drops them. Twenty other sampled frames cover between 8% and 37% of the avatar's middle, with drawn characters, prison bars, a photo's glare or a record player, which is how Steam shows them too, so they stay.

## Geometry

Steam draws a frame's 224 pixel art centred over a 184 pixel square avatar, as its [Points Shop item specifications](https://partner.steamgames.com/doc/marketing/pointsshopitems) give them, so the art is 1.2174 times the avatar. Discord draws decoration art centred at 1.2 times the avatar. The FosscordFrames plugin scales images under `/media/v1/collectibles-shop/8000000000` by 1.0145, which is 1.2174 divided by 1.2, so the art lines up with the avatar's edges. At a 40 pixel avatar that is 0.7 pixels. The frames are drawn for square avatars, so on a round avatar the corners of the square opening stay empty, and a square avatar fills them.

## Other instances

Every instance has the same catalogue, so a Steam frame on someone from another instance keeps its SKU and asset, like Discord's own decorations, and the receiving instance serves the art from its own CDN. An instance whose catalogue lacks the frame maps it to a local id and fetches the art from the sender's `/media/v1/collectibles-shop/<sku>/<slot>`, which serves Steam art the same way.
