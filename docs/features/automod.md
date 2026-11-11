# Instance automod

Automod is a set of instance-wide rules that the server applies to messages, names, signups and sign-ins before it saves anything. Every action is logged on the Automod page of the [admin dashboard](admin.md) at `/admin/#/automod`, which has a form for most settings. Keys on this page are under `automod` in the configuration, except keys that start with `register.`, `user.` or `guild.`, which are full paths.

## Actions

Most rules take one of these actions, and every action except `log` refuses the message:

- `log` writes the automod log and lets the message through.
- `delete` refuses it with error code 200000. Spam rules also delete the earlier messages that counted toward the rule.
- `timeout` times the member out in that server for `spam.timeoutMinutes`. Spam in DMs mutes the account on the whole instance instead.
- `hold` puts a local account back to waiting for approval and signs it out.
- `suspend` suspends the account until the suspension ends.
- `disable` disables the account.

## Slur auto-ban

When someone posts the hard-R n-word in a message, poll, or user, server, channel or thread name, the server refuses it. With the default action `suspend` it also suspends the account for `slurs.suspendDays`, signs it out, records a Hateful Conduct violation that shows on the user's Account Standing page for `slurs.violationDays`, and deletes every message the user ever sent when `slurs.deleteAllMessages` is on. Any other action only refuses the message and takes that action. The matcher sees through look-alike letters, leetspeak, repeated letters, invisible characters and separators, and doesn't match words like Niger or snigger.

| Key                          | Default   | Meaning                                                                                                   |
| ---------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `slurs.enabled`              | true      | The rule for messages and names. Names on the blocked name words list are refused even when it is off.    |
| `slurs.action`               | `suspend` | What a match does.                                                                                        |
| `slurs.includeSoftA`         | false     | Also act on the soft-A spelling.                                                                          |
| `slurs.suspendDays`          | 7         | Suspension length.                                                                                        |
| `slurs.deleteAllMessages`    | true      | Delete every message the user sent.                                                                       |
| `slurs.violationDays`        | 90        | How long the violation shows on Account Standing.                                                         |
| `slurs.actOnVerifiedReports` | true      | Act on reported encrypted messages whose signature verifies, see [Encrypted messages](#encrypted-messages). |

## Word lists and the allow list

`wordLists` holds extra lists and is empty by default. Each list has a `name`, up to 500 `terms`, an `action` from [Actions](#actions) or `name`, and `suspendDays` for `suspend`. A list with action `name` only refuses names, and every other list applies to names and messages. A term matches as a whole word with the same folding as the slur rule, so `ass` matches "@$$" but not "class", and a `*` at the start or end allows longer words on that side, so `scam*` matches "scammer".

`allowList` holds up to 500 words automod never acts on. Not a match in the log adds the matched text to it.

## Names

Usernames, display names, nicknames and server, channel and thread names go through the slur rule and the word lists, at signup, rename and admin edits. The first three also go through `user.identityBlockedTerms`, a list of up to 256 blocked name words that defaults to 9 slurs and that Site settings and the Automod page both edit. Matching ignores case, invisible characters, number substitutions and separators between letters, but other spellings and languages need their own entries. A refused name gets a `NAME_NOT_ALLOWED` field error and never suspends anyone.

The Automod page can scan existing accounts for names the rules would refuse, 10,000 accounts per click, and disable the ones you select.

## Join reasons and approval

| Key                             | Default | Meaning                                   |
| ------------------------------- | ------- | ----------------------------------------- |
| `register.joinReason.required`  | false   | Ask "Why do you want to join?" at signup. |
| `register.joinReason.minLength` | 20      | Shortest answer.                          |
| `register.joinReason.maxLength` | 1000    | Longest answer.                           |
| `register.requireApproval`      | false   | Hold every new account for a moderator.   |

The `fosscordJoinReason` plugin adds the question to the signup form when a reason is required or approval is on. With approval on, registration creates the account as pending, and the form tells the person that a moderator has to approve it before they can sign in. Moderators see the answers in Join requests, which flags short, repeated, mashed or copied answers as low effort, and approve or reject accounts in bulk there.

## Sign-in and signup limits

These limits add to the route rate limits, which allow 2 successful registrations per IP every 12 hours and 5 login attempts per IP per minute by default. Registration tokens skip the signup limits. The address caps count an IPv6 address together with its whole /64.

| Key                                   | Default | Meaning                                                                                  |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `registration.maxAccountsPerIpPerDay` | 0       | Accounts created from one IP in 24 hours, pending ones included. 0 is off.               |
| `registration.maxAccountsPerIp`       | 0       | Accounts registered from one address that aren't deleted or disabled. 0 is off.          |
| `login.maxFailedAttemptsPerAccount`   | 10      | Wrong passwords from one address before the account locks for that address. 0 is off.    |
| `login.lockoutMinutes`                | 15      | Lock length.                                                                             |
| `login.maxAccountsPerIp`              | 0       | Other accounts with a recently used session on one address. 0 is off.                    |
| `login.sessionActiveDays`             | 30      | How recently a session must have been used to count.                                     |
| `ipAllowList`                         | `[]`    | Up to 500 addresses and CIDR ranges, such as `192.0.2.0/24`, that the address caps skip. |

After 10 times the failed attempt limit from all addresses together, the account also locks for every address it has never used. Staff never count toward the address caps, and the caps skip Cloudflare, private and allow-listed addresses. The Automod page has a lookup that lists who counts toward both caps for one address.

## Spam rules

The spam rules check every message, edit and new thread, and skip system accounts and accounts with `BYPASS_RATE_LIMITS`. Each rule is under `spam.<key>` with `enabled`, on by default, `action`, the thresholds below and `exemptAccountAgeDays`, shown as Age. Accounts older than that age skip the rule, and 0 checks everyone. For `burst`, only accounts younger than it count.

| Rule logged as         | Key           | Trips when, with default thresholds                                                                                                                                                                                                  | Age | Action  |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------- |
| `everyone_spam`        | `everyone`    | An account tries @everyone or @here `unpermittedLimit` 2 times without permission, or pings it `permittedLimit` 4 times with permission, within `windowSeconds` 600.                                                                 | 0   | timeout |
| `mention_spam`         | `mentions`    | One message mentions `messageLimit` 10 users or roles, or an account mentions `windowLimit` 20 within `windowSeconds` 60.                                                                                                             | 0   | timeout |
| `flood`                | `flood`       | An account sends `messageLimit` 15 messages within `windowSeconds` 10, or posts in `channelLimit` 5 channels of one server within `channelWindowSeconds` 30.                                                                          | 0   | timeout |
| `duplicate`            | `duplicates`  | The same text of `minLength` 30 or more characters from one account in `channelLimit` 3 channels, or from `accountLimit` 5 accounts, within `windowSeconds` 120.                                                                     | 0   | delete  |
| `link_spam`            | `links`       | An account posts `inviteLimit` 2 invites or `linkLimit` 4 other links within `windowSeconds` 300.                                                                                                                                    | 7   | delete  |
| `new_account_burst`    | `burst`       | `accountLimit` 4 new accounts post the same text of `minLength` 10 or more characters within `windowSeconds` 300.                                                                                                                    | 1   | suspend |
| `duplicate_attachment` | `attachments` | The same file from `accountLimit` 3 accounts, or from one account in `channelLimit` 3 channels, within `windowSeconds` 600. Files under `minBytes` 256 are skipped.                                                                   | 7   | delete  |
| `dm_spam`              | `dms`         | An account opens DMs with `openLimit` 10 non-friends, sends `friendRequestLimit` 10 friend requests, or sends the same DM text of `minLength` 8 or more characters into `sameContentLimit` 4 DM channels within `windowSeconds` 600. | 0   | timeout |

| Key                             | Default                         | Meaning                                                                                   |
| ------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| `spam.ignoreLinkDomains`        | tenor.com, giphy.com, klipy.com | Link domains that don't count toward link spam or repeated content.                       |
| `spam.timeoutMinutes`           | 60                              | Timeout and instance mute length.                                                         |
| `spam.suspendHours`             | 24                              | Suspension length.                                                                        |
| `spam.escalateAfterStrikes`     | 3                               | Hits before each further hit steps the action up one level, up to `suspend`. 0 is off.    |
| `spam.strikeWindowHours`        | 24                              | How long a hit counts as a strike.                                                        |
| `spam.dms.newAccountHours`      | 72                              | Accounts younger than this can only open `spam.dms.newAccountDmsPerHour` new DMs an hour. |
| `spam.dms.newAccountDmsPerHour` | 5                               | New DMs an hour for those accounts.                                                       |

Members who can manage the server are exempt from the permitted @everyone, mention and channel flood limits. Links to this instance don't count as links. Plain text with no link or mention only counts as repeated content when it shows up in 2 or more channels or one account sends it more than once, so new members who each type the same verification phrase once pass. Encrypted messages only count toward the flood and file rules.

## Scam and phishing links

The scam check reads every link in messages, edits and new threads. It refuses the message, logs it with rule `scam_link` and applies `scam.action` when a link uses a brand such as Discord or Steam on a domain that isn't the brand's own, spells it with look-alike letters, offers free Nitro or gifts, asks people to scan a QR login code, points to an IP logger, uses a shortener from a young account, or is on a listed domain. Bots are skipped.

| Key                                                   | Default  | Meaning                                                      |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `scam.enabled`                                        | true     | The scam check.                                              |
| `scam.action`                                         | `delete` | What a hit does.                                             |
| `scam.lookalikes`, `giftBait`, `qrLogin`, `ipLoggers` | true     | Each kind of check. `lookalikes` covers look-alike letters.  |
| `scam.shortenerAccountAgeDays`                        | 7        | Refuse shorteners from accounts younger than this. 0 is off. |
| `scam.extraDomains`                                   | `[]`     | Domains to always refuse.                                    |
| `scam.allowDomains`                                   | `[]`     | Domains to always let through.                               |
| `scam.remoteListUrl`                                  | `""`     | A domain list to fetch, up to 8 MB. Empty is off.            |
| `scam.remoteListRefreshMinutes`                       | 360      | How often to fetch it, at least 15.                          |

The remote list can be one domain per line, a hosts file, a JSON array or a JSON object with a `domains` array. The Automod page shows its status and can fetch it right away. `guild.safety.harmfulLinkDomains`, empty by default, is an older list of domains the server refuses without logging.

## Signup scoring

Every signup gets a score before the captcha is used up, and registration tokens skip it. These signals add their weight to the score:

| Signal             | Weight key and default     | When                                                                                         |
| ------------------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| `disposable_email` | `disposableEmailWeight` 40 | The email domain is on the bundled list of disposable mail services.                         |
| `similar_names`    | `similarNameWeight` 30     | `similarNameLimit` 3 or more signups in the window share a username stem or first 6 letters. |
| `same_password`    | `samePasswordWeight` 30    | `samePasswordLimit` 2 or more signups in the window used the same password.                  |
| `fast_captcha`     | `fastCaptchaWeight` 25     | The captcha was solved in under `fastCaptchaMs` 1500 ms.                                     |

| Key                          | Default | Meaning                                                               |
| ---------------------------- | ------- | --------------------------------------------------------------------- |
| `signup.enabled`             | true    | Signup scoring.                                                       |
| `signup.windowMinutes`       | 30      | How far back similar names and passwords count.                       |
| `signup.logScore`            | 20      | Log the signup with rule `signup_bot`. 0 is off.                      |
| `signup.holdScore`           | 60      | Create the account as pending, the same as manual approval. 0 is off. |
| `signup.refuseScore`         | 0       | Refuse the signup. 0 is off.                                          |
| `signup.deniedEmailDomains`  | `[]`    | Domains always refused.                                               |
| `signup.allowedEmailDomains` | `[]`    | Domains that never count as disposable.                               |

The server keeps no password data. It compares the last 5,000 signups in memory, and a restart clears them.

## New account quarantine

While the quarantine is on, accounts younger than `quarantine.hours` can't post links other than to this instance, upload files, send embeds or use @everyone or @here, and have lower mention and DM limits. Bots, system accounts, accounts from other instances and accounts with `BYPASS_RATE_LIMITS` are never quarantined. The Automod page lists the accounts in quarantine and can release them early.

| Key                                                        | Default | Meaning                                                           |
| ---------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `quarantine.enabled`                                       | false   | The quarantine.                                                   |
| `quarantine.hours`                                         | 24      | How long it lasts.                                                |
| `quarantine.allowLinks`, `allowAttachments`, `allowEmbeds` | false   | Let quarantined accounts post links, upload files or send embeds. |
| `quarantine.maxMentions`                                   | 2       | Mentions per message.                                             |
| `quarantine.maxDms`                                        | 3       | New DMs during the quarantine.                                    |

## Server verification levels and the explicit media filter

The server applies each server's own verification level to messages, threads and reactions. Level 1 needs a verified email, level 2 adds an account older than 5 minutes, level 3 adds membership longer than 10 minutes, and level 4 adds a phone number when `verification.requirePhoneForHighest` is on. The owner, bots, members with any role and members with the bypass verification flag skip the check.

The explicit media filter applies each server's explicit content filter outside NSFW channels, to members without roles at level 1 and to everyone at level 2. There is no image classifier. The filter marks a file when its name, title or description has a word from `explicitContent.terms`, when its SHA-256 is in `explicitContent.blockedHashes`, or for every image and video when `flagAllMedia` is on. The client blurs a marked file, and the message is still delivered.

| Key                                   | Default  | Meaning                                                                                                     |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `verification.enforce`                | true     | Apply server verification levels.                                                                           |
| `verification.requirePhoneForHighest` | false    | Ask for a phone number at level 4. Without it level 4 works like level 3, and the instance has no SMS provider. |
| `explicitContent.enabled`             | true     | The explicit media filter.                                                                                  |
| `explicitContent.flagAllMedia`        | false    | Mark every image and video where the filter applies.                                                        |
| `explicitContent.terms`               | 11 words | Up to 500 file name words that mark a file.                                                                 |
| `explicitContent.blockedHashes`       | `[]`     | Up to 5,000 SHA-256 hashes that mark a file.                                                                |

## Federation

Every message rule covers accounts from other instances and acts on their copy here. When one of them trips a rule, this server sends a signed report to their home instance, at most once an hour per account and rule. The home instance files it in Reports as "Automod on another instance".

| Key                                    | Default | Meaning                                                |
| -------------------------------------- | ------- | ------------------------------------------------------ |
| `federation.reportToHome`              | true    | Report hits on remote accounts to their home instance. |
| `federation.acceptReports`             | true    | Accept those reports about local accounts.             |
| `federation.reportsPerHourPerInstance` | 120     | Reports accepted from one instance per hour.           |

## Raid detection

The server watches each server for join, DM and mention raids. A raid posts Discord's raid alert to the server's safety alerts channel, at most once an hour per kind, and Discord's Pause invites, Disable DMs and Report false alarm buttons work. The keys are under `guild.safety`.

| Raid    | Trips when                                                                                                                                                                                                          | Then                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Join    | `raidJoinThreshold` 15 joins within `raidJoinWindowSeconds` 120, `raidNewAccountJoinThreshold` 8 joins from accounts younger than `raidNewAccountHours` 24, or `raidInviteJoinThreshold` 10 joins through one invite. | Pauses invites for `raidPauseInvitesMinutes` 60.                  |
| DM      | `dmRaidThreshold` 10 members start DMs with other members within `dmRaidWindowSeconds` 300.                                                                                                                          | Pauses DMs between members for `dmRaidPauseDmsMinutes` 60.        |
| Mention | `mentionRaidThreshold` 3 accounts trip mention or @everyone spam in one server within `mentionRaidWindowSeconds` 300.                                                                                               | Alerts only.                                                      |

`raidJoinThreshold` 0 turns join raids off, and a pause length of 0 only alerts. The join thresholds grow with the server, so a server of 20,000 members needs about 100 joins in 120 seconds.

## Rule switches, dry runs and exemptions

`policies` holds one entry for each of 20 rules: `everyoneSpam`, `mentionSpam`, `flood`, `duplicate`, `linkSpam`, `newAccountBurst`, `duplicateAttachment`, `dmSpam`, `scamLink`, `slurs`, `wordLists`, `quarantine`, `verificationLevel`, `ipAccountLimit`, `ipLimit`, `signupBot`, `explicitContent`, `joinRaid`, `mentionRaid` and `dmRaid`.

| Field                  | Default                                                                  | Meaning                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`              | true                                                                     | The switch for word lists, the address caps, the daily signup limit and the 3 raid rules. The other rules use their own `enabled`. |
| `dryRun`               | false                                                                    | Log what the rule would do and act on nobody.                                                                                       |
| `exemptStaff`          | true for the spam rules, quarantine, `ipAccountLimit` and the raid rules | Skip operators and accounts with a staff role.                                                                                      |
| `exemptBots`           | true for the spam rules, `scamLink`, quarantine and `verificationLevel`  | Skip bots.                                                                                                                          |
| `exemptVerifiedEmail`  | false                                                                    | Skip accounts with a verified email.                                                                                                |
| `exemptAccountAgeDays` | 0                                                                        | Skip accounts older than this. The spam rules use their own age setting instead.                                                    |
| `exemptUserIds`        | `[]`                                                                     | Up to 500 user IDs to skip.                                                                                                         |
| `exemptGuildIds`       | `[]`                                                                     | Up to 500 server IDs to skip.                                                                                                       |

## Appeals

An account that can't sign in because it is suspended, held or disabled gets a sign-in error that points to `<instance>/appeal`. There the person signs in, sees the restriction, the reason and when it ends, and can send one appeal of up to 1,000 characters per restriction. Accounts from other instances can't use the page. Accepting an appeal in the Appeals section of the Automod page lifts the restriction and marks the automod action as a false positive.

## Server AutoMod rules

The server also enforces each server's own Discord AutoMod rules on message create and edit: keyword, keyword preset, spam, mention spam and member profile rules.

## Encrypted messages

Automod only sees plaintext, so the message rules skip encrypted DMs. When a reported encrypted message verifies as [e2ee.md](e2ee.md#reporting-encrypted-messages) describes, `slurs.actOnVerifiedReports` is on and the text has the slur, the server deletes the message and applies the slur action. Word lists don't act on reports.

## Automod page

The page needs `VIEW_MODERATION` to read, `MODERATE_USERS` to act on accounts and `MANAGE_USERS` to change settings. Besides the forms and lists above, it has the log, a review queue of the last 24 hours, rule stats with false positive rates, raid incidents and a test box that runs text, an email, a username and an address through every rule without acting on anyone. Undo on a log entry reverses the action, except deleted messages stay deleted. Saving a list setting replaces the whole list.
