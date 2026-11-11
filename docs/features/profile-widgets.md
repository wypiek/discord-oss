# Profile widgets

The Board tab of a profile shows widgets. Discord only lets partner apps make application widgets, the cards with a greeting, an image and items, stats or a progress bar. Here anyone can make one in the developer portal and put it on their own profile.

## Making one

On `/developers/applications`, New profile widget creates an application with your name and avatar and opens its Profile Widget page, which every application has.

The page edits and previews the three parts of the card:

- Top: a title, up to three lines under it and an image, either large and cut out or square.
- Bottom: four items with an icon, a name and a description, six stats with a label, or a progress bar.
- Profile popout: one line and an image, which defaults to the top image.

Add to my profile puts the widget on your Board.

A text field holds fixed text, or `{{key}}` to show a value set for each person. The Your values card sets your own values, and the application's bot sets anyone's. The progress bar always reads its numbers from values.

Only the owner can add a widget until Let anyone add this widget makes it public. Anyone the application has values for can also add it.

## Values from a bot

| Route | Use |
| --- | --- |
| `GET /applications/:application_id/users/:user_id/widget-data` | The values set for a user. |
| `PUT /applications/:application_id/users/:user_id/widget-data` | Replaces them with `{ "data": { "visits": "10M+", "level": 12 } }` and an optional `username`. |
| `PATCH /applications/:application_id/users/:user_id/widget-data` | Changes the keys it sends. A key set to `null` is removed. |
| `DELETE /applications/:application_id/users/:user_id/widget-data` | Clears them. |

The application's bot token or the owner's own session can call them, and `@me` works as the user id. A user can have up to 50 keys of 1 to 32 letters, numbers and underscores, and each value is a number or a string of up to 256 characters.

## Reports

Someone else's widget has Report Widget in its menu. The report stores a snapshot of the widget's text and images as the reporter saw them, and the admin dashboard shows it as Reported widget.
