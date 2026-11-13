# Custom typing indicator

People can replace the dots and "is typing…" that others see while they type. Edit Profiles, or clicking your own profile, opens the profile editor, whose sidebar has a Typing Indicator tile with a preview. Clicking it opens the editor, which offers:

- up to three emojis instead of the dots, picked in the client's own emoji picker or pasted
- an animation for the emojis: None, Pulse, Ring or Wave
- the text after the name: "is typing…", one of Discord's seven presets such as "is yapping…", or the person's own text of up to 32 characters
- Surprise me, which picks random emojis, an animation and a preset, and Reset, which goes back to the default

Each chosen emoji shows as a tile with a remove button, followed by an Add emoji tile until there are three. Both open Discord's emoji picker, the one the message box uses, with search, Frequently Used, the emojis of every server you are in and the skin tone selector. Clicking a chosen emoji replaces it, Add emoji adds one, and shift-clicking in the picker keeps it open to add several until all three are filled. A Unicode emoji is stored as `unicode_emoji` with the skin tone you picked, and a server emoji as `custom_emoji_id`. The server reads `animated` from the emoji itself, so animated server emojis animate in the indicator. The field under the tiles still takes a pasted Unicode emoji or a custom emoji written as `<:name:id>` or `<a:name:id>`, and Save also keeps an emoji left in it. The picker runs with Discord's `TYPING_INDICATOR` emoji intention, which allows emojis from other servers, and the `FosscordTypingIndicator` plugin finds it by its code, so no client patch is involved.

The style is saved as `typing_indicator_style` on the user with `PATCH /api/v9/users/@me`, in Discord's format of `emojis`, `animation` and `typing_suggestion`, plus `custom_text`, which Discord doesn't have. The server keeps at most three emojis, refuses text that isn't an emoji, checks that custom emojis exist, collapses whitespace in the text and cuts it to 32 characters. An empty style is stored as nothing. The style is part of the public user object, so other clients receive it with the user.

The web client shows a custom indicator when exactly one person is typing in the channel. With two or more, it shows the usual "A and B are typing…". The `FosscordTypingIndicator` plugin draws the emojis and the text and keeps `custom_text` when the client reads and saves the style.
