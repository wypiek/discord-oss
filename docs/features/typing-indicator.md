# Custom typing indicator

People can replace the dots and "is typing…" that others see while they type. The editor is in User Settings, Profiles, under Typing indicator, and offers:

- up to three emojis instead of the dots, each a Unicode emoji or a custom emoji written as `<:name:id>`
- an animation for the emojis: None, Pulse, Ring or Wave
- the text after the name: "is typing…", one of Discord's seven presets such as "is yapping…", or the person's own text of up to 32 characters
- Surprise me, which picks random emojis, an animation and a preset, and Reset, which goes back to the default

The style is saved as `typing_indicator_style` on the user with `PATCH /api/v9/users/@me`, in Discord's format of `emojis`, `animation` and `typing_suggestion`, plus `custom_text`, which Discord doesn't have. The server keeps at most three emojis, refuses text that isn't an emoji, checks that custom emojis exist, collapses whitespace in the text and cuts it to 32 characters. An empty style is stored as nothing. The style is part of the public user object, so other clients receive it with the user.

The web client shows a custom indicator when exactly one person is typing in the channel. With two or more, it shows the usual "A and B are typing…". The `FosscordTypingIndicator` plugin draws the emojis and the text and keeps `custom_text` when the client reads and saves the style.
