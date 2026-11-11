# Admin API coverage

The first inventory contains **736 server operations across 559 generated OpenAPI paths**, **73 existing admin operations**, and **378 static and 564 directly returned template URL constants from the cached native client**, plus **16 literal route call anchors in extensions/encryption code**. The machine-readable map is [admin-api-coverage.json](admin-api-coverage.json). It is a review baseline, not a claim that the dashboard already manages every feature.

| Classification            | Operations | Meaning                                                                                                                                                                           |
| ------------------------- | ---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing admin operations |         64 | Explicit administrative routes already present.                                                                                                                                   |
| Covered user operations   |          2 | Disable/delete have matching target-account controls.                                                                                                                             |
| Partial coverage          |        126 | An admin form covers some fields or related resources, but not the entire native operation.                                                                                       |
| Missing or unverified     |        480 | No equivalent admin control has been established by this first pass.                                                                                                              |
| Account-owner flows       |         51 | Authentication, cryptographic identity, token access and MFA setup cannot be safely mirrored by impersonating a user. Administrative recovery/revocation is a separate operation. |

The generated OpenAPI operation list is exhaustive for that artifact. The native-client extraction includes static and directly returned template URL constants, with literal extension/encryption calls. These are candidates and can include frontend navigation paths; arbitrary function-built URLs, lazy code and optional plugins require further inspection. Classification is deliberately conservative, with evidence notes on each operation. A route appearing under `/admin` does not prove its form covers every field.

## Per-user customization

Target-user customization is the clearest gap: operators can edit the existing global profile but cannot manage another user's pride flags, profile widget layout or ordinary client preferences through equivalent scoped controls. The first batch implements seven scoped admin operations for these controls with `MANAGE_USERS`, the existing operator-target protection, catalog validation and widget eligibility rules. It does not transfer application ownership or expose hidden application identity values. Pride/widget mutations and their audit entries commit together; the preference adapter retains the existing legacy/protobuf mutation flow and appends its audit entry after saving. Preference writes and their audit entry are not yet one database transaction. Each audit entry records the actor, target, section and changed field names, without raw preference values or secrets.

## Next batches

1. Server-specific member profiles: avatar, banner and theme. The server drawer's Members section already lists and searches members, sets nicknames and roles, times members out, removes and bans them, under `/admin/guilds/{guild_id}/members`.
2. Entitlements, shop ownership, library and currency adjustments with explicit transaction records. Free catalog products do not imply every per-user inventory endpoint is covered.
3. Connected-account metadata and removal, saved avatars, consent/email preferences and notification settings. Secret access-token endpoints remain account-owner flows.
4. Scheduled messages, saved-message metadata and notification subscriptions. Encrypted message contents remain unreadable to administration without the recipient's keys.
5. Guild feature completeness: permission overwrites, thread and forum settings, events, onboarding, applications and integrations, plus uploading emoji, stickers and sounds. Bans, invites and editing or deleting emoji, stickers and soundboard sounds have admin routes under `/admin/guilds/{guild_id}` since the server drawer sections were added.
6. Developer applications, bots, webhooks and interaction configuration with scoped administrative controls and audit records.

Password hashes, session tokens, OAuth tokens, MFA secrets, private encryption keys, sealed backups and recovery codes are excluded from ordinary admin response projections. Administrative operations must act on an explicit target and retain their normal resource validation and eligibility rules. The audit does not propose a blanket `@me` impersonation proxy.

[admin.md](../features/admin.md) describes the dashboard itself.
