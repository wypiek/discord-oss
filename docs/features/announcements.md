# Encrypted announcements

Operators send an [encrypted](e2ee.md) DM from the instance's official account on the Announcements page of the admin dashboard. The audience is everyone, staff, or 1 to 100 selected local human accounts, which lets you test delivery on disposable accounts.

Attachments can add up to 10 MiB in total. They are encrypted like any DM attachment, with the file names inside the encrypted message.

## Delivery

Every 5 seconds a worker sends up to 16 due deliveries, 4 at a time. A recipient with no active encryption device stays queued until they have one. Other errors are retried with a growing delay, and the recipient is marked failed after 10 attempts.

Deleting an announcement cancels its queued deliveries, removes the messages already delivered and deletes its stored files.

## Private files and backups

| Variable | Default | Holds |
| --- | --- | --- |
| `E2EE_SYSTEM_KEY_DIR` | `.e2ee-system` next to `CONFIG_PATH` | The official account's private key seed. The Official inbox uses it too. |
| `ANNOUNCEMENT_SPOOL_DIR` | `.announcement-spool` next to `CONFIG_PATH` | The encrypted attachments of each announcement, sealed under a key derived from that seed. |

The server creates both directories with mode 700 and their files with mode 600, and refuses looser permissions or a symlink. Docker keeps both in the `state` volume.

Back up and restore the database and both directories together, as [setup.md](../self-hosting/setup.md#data-and-backups) describes. Losing the seed makes the stored attachments unreadable, and the server refuses to create a new seed while the official account has encryption keys, so restore the original file. Don't delete the spool file of an announcement that still has queued recipients, because the server then marks those deliveries as failed instead of sending text only.
