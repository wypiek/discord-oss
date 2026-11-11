# Native UI components

`client/plugins/fosscordCore/ui.tsx` provides small adapters for settings sections, labeled inputs, and buttons. They use the pinned client's actual `@webpack/common` exports: `Forms.FormTitle`, `Text`, `TextInput`, and `Button`. Pride badges also use the native `Checkbox`. This shares Discord's control styling and interaction behavior; it is a small reusable foundation, not a full UI tester clone.

Import `SettingsSection`, `Field`, and `Button` from `../fosscordCore/ui` in another Fosscord plugin. Give fields stable IDs and visible labels. Use the secondary button variant for supporting actions. Keep request state and validation in the feature component.

Use current semantic tokens such as `--text-default`, `--text-muted`, `--background-base-lowest`, `--background-mod-subtle`, `--border-subtle`, and `--focus-primary`. Check both themes in a real render: older tokens can be undefined in the pinned client. Scope feature layout rules to its own classes. Pride's mobile Profiles adjustments apply only while its picker is mounted, preserve native settings navigation and Close, and stack the profile preview below the form.

After changing these adapters or plugin controls, build Equicord and run `bun run check:client` with `ORIGIN` pointing at a running instance. `scripts/dev/pride-badges-smoke.mjs` checks pride badge persistence, local artwork, cached profile updates, clearing, search and preservation of assigned badges. Also check keyboard access, desktop dark and light renders, and phone navigation, scrolling, search and saving.
