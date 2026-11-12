# Testing status

Testing is a fifth status next to Online, Idle, Do Not Disturb and Invisible. Others see it as a full dot like Online, colored `#3BA3E8`. It mutes notifications the same way Do Not Disturb does: no desktop notifications, notification sounds or incoming call rings, and no push notifications from the server.

Only accounts with the `TESTING_PRESENCE` instance right (bit 57) can use it. Operators have it through `OPERATOR`, and a staff role can carry it too. Turn it on for an account in the admin dashboard under the account's rights.

## Server

- `src/gateway/util/SettableStatus.ts` decides which statuses a session may set. `testing` needs the right, checked against the account's effective rights each time it is requested, in Identify and in presence updates (op 3). Without the right the request is ignored and the session keeps its status, or falls back to online on Identify.
- `PATCH /users/@me/settings` drops a `testing` status from accounts without the right.
- READY sends the account's effective rights in `user.rights`, so the client knows whether to offer the status.
- Online counts, the widget, the shield badge and presence aggregation count `testing` as online. Push notifications skip `testing` users like `dnd` users.

## Client

`client/plugins/fosscordTestingStatus` adds `TESTING` to the client's status types, colors the dot, uses the Online dot shape, labels it Testing, and adds it to the status picker below Do Not Disturb when the READY rights allow it. Every place the client checks its own status for Do Not Disturb before notifying, ringing or playing a sound treats Testing the same way, and the friends list counts Testing friends as online.
