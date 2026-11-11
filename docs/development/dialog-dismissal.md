# Dialog dismissal inventory

This inventory describes how owned dialogs and popovers dismiss. It does not cover every upstream Discord or Equicord dialog in the cached client.

| Surface                                      | Owner                                                            | Outside pointer                                                                                  | Escape                                                      | Unsaved edits and completion                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Email verification and remote-auth decisions | assets/client_patches/60-auth-pages.js                           | Does not dismiss                                                                                 | Cancel event is prevented                                   | Explicit result, cancel or completion action closes the native dialog                                                |
| Admin drawers                                | assets/public/admin/admin.js                                     | Elements with data-close invoke closeDrawer                                                      | Invokes closeDrawer                                         | Dirty forms require discard confirmation; session expiry forces cleanup; pending saves preserve newer edits          |
| Portal confirmation                          | assets/public/developers/portal.js confirmDialog                 | No outside-dismiss handler                                                                       | Native cancellation                                         | Only the confirm return value authorizes the action; route change returns cancel                                     |
| Portal application and widget creation       | assets/public/developers/portal.js createDialog and widgetDialog | No outside-dismiss handler                                                                       | Native cancellation                                         | Cancel closes without a draft prompt; submitted creation continues but a closed dialog cannot navigate on completion |
| Encryption dialogs                           | client/e2ee/src/ui.ts dialog                                     | Dismisses only when both pointerdown and click target the dialog shell, and dismissal is enabled | Prevents native cancellation, then closes only when enabled | Required-password and recovery operations can disable dismissal and hide the close control                           |
| Native signup                                | client/plugins/fosscordCap and fosscordPride/signup.tsx          | Form controls, not an owned modal                                                                | No owned overlay to dismiss                                 | Required Cap validation remains on the form; pride selection is an inline picker                                     |
| Insights hover details                       | client/plugins/fosscordInsights/index.tsx                        | Inline hover details, not a blocking dialog                                                      | No owned modal cancellation                                 | Inspect keyboard and touch exposure separately                                                                       |
| Upstream client modal and popout layers      | client/plugins/fosscordModals/style.css                          | Upstream owns event handling                                                                     | Upstream owns event handling                                | Our plugin only changes scrim and inactive-layer stacking; its description is not evidence of dismissal behavior     |

The encryption factory also owns enable-encryption, safety numbers, reset, optional unlock, new-login approval, backup, recovery, device removal and settings dialogs. Their caller actions decide when to close. Factory checks establish dismissal mechanics, not successful encryption transport or every caller lifecycle.

`bun test scripts/tests/auth-modal-focus.test.cjs scripts/tests/client-dialog-scroll.test.cjs` exercises required decisions, background inertness, focus restoration, nested layers and scroll locks in Chromium and WebKit. `bun test scripts/tests/portal-dialog-lifecycle.test.cjs` covers pending creation and route cancellation.

Open work is tracked in [work-backlog.md](work-backlog.md): MOD-009 for unsaved portal and encryption drafts, MOD-010 for required-password and signup dialogs, MOD-011 for mobile touch checks, MOD-012 for encryption and authentication route and error lifecycles, and MOD-004 for upstream profile and banner pickers and other cached-client popovers.

## Developer portal

Developer portal dialogs lock document scrolling while any native modal is open. Closing only the top dialog keeps the lock; closing the last one restores scrolling at the original position. The stylesheet does not change existing inline overflow values.

The developer portal closes open dialogs when the route changes. Closing a pending application or widget dialog prevents a late response from navigating away; submitted creation still finishes. Route changes cancel deletion confirmations without sending a deletion request.

Widget creation captures the portal render version before reading the current user. A response from an earlier render cannot open a dialog after navigation, including a later render of the same URL. A current response still opens the normal widget form.

Widget preloading is scoped to the render that started it. A delayed current-user response from an earlier render cannot reopen a dialog on the new page.

Repeated profile-widget opening requests use a request version as well as the route render version. Only the latest pending request may open its form, preventing duplicate native dialogs from repeated activation. This does not coalesce the current-user GET requests or undo an application creation.

Portal reads are scoped to the render that started them. Obsolete application lists, application detail responses, section content and errors cannot replace the current page or steal its focus. Navigation and document titles publish only after the current section finishes.

General-information saves are scoped to their editor render. A successful response from an obsolete or detached form cannot rewrite current navigation, and its error cannot focus old fields. Submitted server writes still finish; a current editor retains its ordinary saved status and validation behavior.

Creation and reset tokens stay in portal memory under their application ID until that application displays them. An unrelated bot page neither displays nor consumes them. Late bot creation does not refresh a newer page, and returning to the original application can show the token once. Tokens are not written to browser storage or probe output.

Application deletion disables its opener while the submitted request is pending. Confirmations from obsolete or detached editors cannot submit it, and late completion or failure cannot redirect or change the current page. A confirmed deletion already submitted still finishes on the server.

Activity enable/disable, settings and mapping callbacks are scoped to their editor render. Obsolete responses cannot refresh the current page or change its status and validation fields, and late mapping errors cannot focus a matching input ID on another application. Pending disable requests disable their opener; obsolete confirmations cannot submit them. Submitted writes still finish.

Widget deletion is scoped to its editor render. Its pending opener is disabled, cancelled or obsolete confirmations submit no request, and late completion or failure cannot refresh or change a newer page. Submitted widget deletion still finishes on the server.

Widget value saves preserve edits made while the request is pending. Changed keys and values, added rows and removed rows remain in the editor; the response updates the saved preview and reports that newer changes are unsaved. A second explicit save submits the retained draft. Obsolete or detached value editors ignore late success and failure callbacks.

General-information saves preserve newer tag and icon drafts. A response only normalizes tags and clears their input if the form still matches its submitted snapshot. It clears only the icon submitted by that request, retaining a later upload for the next explicit save. Editing any information field while pending leaves an unsaved-changes status. Unchanged submissions keep the ordinary saved status.

Application PATCH replaces the full submitted tag list, including an empty list. It trims and deduplicates tags before replacing them; omitted tags leave the existing list unchanged. Owner authorization and tag-length validation still run before persistence.

Application PATCH replaces supplied OAuth redirect URLs and installation configuration exactly. Shorter redirect lists remove old entries and an empty list removes every redirect. Supplied installation configuration replaces old contexts and their default scopes; omitted OAuth settings stay unchanged. Existing owner, URL, scope and permission validation remains in place before saving these OAuth settings. Removing a context prevents new authorization for that context. The entity type also reflects the nullable installation parameters already allowed by the request schema.

Application description and bot biography writes run in one database transaction after metadata validation. Invalid tags, install settings and terms/privacy URLs reject before either metadata row is saved. A database failure on either row rolls back both writes. Omitted descriptions leave the biography untouched, and an explicit empty description clears both fields. File staging and activity setup remain outside this metadata transaction.

Widget configuration saves and profile add/remove responses are scoped to their editor render. Late success and failure callbacks leave newer pages and detached editor messages unchanged. Submitted writes still finish on the server.

Widget image uploads belong to their editor render and picker request. A file read that finishes after navigation, removal or replacement submits no upload. Already submitted uploads may finish, but late results cannot restore a removed image, replace a newer choice or publish an obsolete error. An older completion cannot enable a newer pending upload. Removing an image immediately permits another selection.

Widget saves send the image keys known at submission and the keys retained by alternate draft layouts. The server validates each optional list as at most 20 nonempty strings of at most 64 characters. It prunes only submitted images no longer used or retained, preserving uploads that arrived after submission. Legacy requests without a submitted key list still prune unused images. Configuration saves, uploads and deletion lock the application row in database transactions; subsequent file cleanup locks and rechecks the current asset list before deleting files. Newer title, visibility, layout and image choices remain editable, and the portal reports unsaved changes after an older save completes. A later image completion also marks its draft unsaved.

Widget profile add/remove actions keep their pending state independently of configuration saves. A configuration response cannot enable a profile action that is still running. Repeated activation submits no additional profile write, and completion or failure restores the appropriate action. Obsolete and detached profile editors cannot start new writes.

OAuth redirect saves preserve edits made while their request is pending. Added, changed and removed rows stay in the editor; the authorization picker updates from the saved URLs and the status reports newer changes as unsaved. A second explicit save submits the retained list. An older rejected submission does not mark or focus newer inputs. Obsolete or detached redirect editors ignore late success/failure callbacks and cannot submit new writes.

Client-secret reset openers stay disabled during confirmation and submission. Pending resets are keyed by application, so returning to the same editor cannot start a duplicate reset. Cancelled or obsolete confirmations submit no request. A late successful secret stays in memory until its own OAuth editor is mounted, then appears once; it never appears on another application and is not written to browser storage. Returning before completion displays the secret on the current matching editor. Obsolete reset failures leave newer pages unchanged.

Bot-token reset openers stay disabled during confirmation and submission, including after returning to a pending reset on the same application. Cancelled or obsolete confirmations submit no request. Late successful tokens stay in page memory until their own bot editor mounts, then appear once. A reset response can fill a newly mounted matching editor, but cannot display a token or error on another application. Tokens are not written to browser storage.

Bot-profile saves retain username and avatar edits made while a request is pending. Only the submitted avatar is cleared on success, and newer drafts report unsaved changes. Duplicate submits are ignored while saving. Completed saves and file reads affect only their current connected editor; the most recently selected image wins when reads finish out of order.
