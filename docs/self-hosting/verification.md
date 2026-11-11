# Getting verified

An approved instance federates with every other approved instance, and its admins can verify their servers for global discovery and answer for them. [registry.md](registry.md) covers the registry side.

## Requirements

- A recent Meowcord version with federation on, over HTTPS, with registration captchas and pride flags on and nothing behind a paywall.
- Active moderation, and a way for the project's moderators to reach you. Put your Discord username in your pull request.
- A public Terms of Service that bans:
  - sexual content of any kind, including pornography and non-consensual intimate media such as sharing or threatening to share private sexual images, AI-generated or deepfake ones included.
  - harassment, doxxing, threats, incitement to violence, glorifying violent attacks and promoting terrorist or violent extremist groups.
  - attacking or demeaning people for their race, ethnicity, nationality, religion, sex, gender identity, sexual orientation, disability or age, including slurs, misgendering and deadnaming.
  - encouraging or instructing suicide, self-harm or eating disorders. Supportive and recovery discussion is allowed.
  - spam, scams and manipulation, such as unsolicited advertising, repetitive posting, bot activity, fake engagement, vote or metric manipulation, phishing, fake giveaways, pyramid schemes and deceptive financial offers.
  - misleading impersonation of a person, brand or organization.
  - anything illegal under Portuguese law or applicable EU law.
  - ban evasion, including new accounts made to get around a ban, a suspension or these rules.

An instance that doesn't enforce these rules can be banned from verification for a time or for good. The registry admins can refuse any request and remove any approved instance.

## Requesting approval

Add your instance to `instances.json` in a pull request, as [CONTRIBUTING.MD](../../CONTRIBUTING.MD#listing-an-instance) describes. The Copy entry button on the Federation page of the admin dashboard gives you the entry.

Unless `federation.announce` is off, your instance also announces itself on start, daily and on Send to registry, which puts it in the review queue. Other instances see it within about an hour of the merge.

## Staying approved

- Keep `federation.key` and back it up with `jwt.key`. When an approved instance serves a different key, the registry ignores its discovery list until its admins confirm the change, so open an issue when you rotate it on purpose.
- Keep updating, or protocol changes can stop your instance from federating.
- Keep your admin contacts current. Each announce privately sends up to 10 handles, the operators unless `federation.contacts` names others, plus your user, server and daily message counts. The registry admins add the contacts to a group DM of all instance admins.
- Act on reports, or the registry suspends your instance and other instances stop federating with it.

## Verifying a server for discovery

The server owner turns on Show on other instances, and you press Verify on the Federation page, see [federation.md](../features/federation.md#listing-a-server-on-other-instances). Other instances show it about 5 minutes later, or after a few hours with `federation.announce` off.

Before you press Verify, check that the server's name, icon and description match what it is, that its moderators enforce its rules, that AutoMod and raid protection are on unless it is small, and that its content is fine for anyone. Take back, or the owner turning the switch off, removes it.
