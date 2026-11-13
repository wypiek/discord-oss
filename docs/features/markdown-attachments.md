# Markdown attachments

A text file attached to a message shows as a preview card with the file name, its size, a language picker (the `<>` button), a button that opens the whole file in a dialog and a menu with Download, Wrap Text and Render Markdown. For files whose extension is `md`, `markdown`, `mkd` or `mkdown`, Discord's client renders the Markdown itself. Raw HTML in the file stays text, links go through the client's own link handling and only a fixed set of tags is drawn.

## Math

The FosscordMarkdownMath plugin in `client/plugins/fosscordMarkdownMath` typesets LaTeX math in that preview with KaTeX 0.19.1. Discord's preview already splits math out of the text before the Markdown is parsed, so underscores, asterisks and backslashes inside a formula are left alone. Without the plugin it shows each formula as code.

| Written as           | Shown as                                   |
| -------------------- | ------------------------------------------ |
| `$...$`              | Inline math.                               |
| `\(...\)`            | Inline math.                               |
| `$$...$$` in a line  | Display math, on its own centred line.     |
| `$$...$$` on its own | A display block, centred.                  |
| `\[...\]`            | A display block, centred. It can span lines. |

`$` delimiters follow Discord's rules: no space just inside the delimiters and no digit right after the closing `$`, so `$5 and $10` stays text. `\\(` is an escaped backslash followed by a parenthesis, not math. Math inside inline code or a fenced code block stays code. A delimiter that never closes stays text, so the collapsed card, which shows only the first 6 lines, can show the start of a `\[` block as text until it is expanded.

The card and the whole-file dialog both render math. A formula wider than the card scrolls sideways. KaTeX draws with the current text colour, so it follows the dark and light themes. Turning off Render Markdown in the menu, or picking another language with `<>`, shows the raw source.

## Safety

The file comes from whoever sent it, so the plugin treats it as hostile.

- Discord's renderer builds React elements from the Markdown tokens. HTML in the file is never parsed as HTML, `javascript:`, `data:` and other unsafe links are shown as their Markdown source, and images become links instead of being loaded.
- Only the formula's KaTeX output is inserted as HTML. KaTeX runs with `trust: false`, so `\href`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlStyle`, `\htmlId` and `\htmlData` render as red command names and nothing else. `maxExpand` is 1000 macro expansions and `maxSize` is 20 em, so a formula can't loop or draw a huge box.
- A formula longer than 2,000 characters, or one that KaTeX can't parse, is shown as code the way the client shows it without the plugin.
- Before the output is used, `isSafeMathMarkup` checks it against the tags and attributes KaTeX emits. Anything else, such as an `href`, an `on` handler, a `src` or a style with `url(`, makes the formula fall back to code.
- The client fetches at most the first 50,000 bytes of a file and walks at most 5,000 Markdown tokens. Rendered formulas are cached, 256 at a time.

## Files

KaTeX's JavaScript is bundled into `assets/vencord/vencord.js` through `pluginDependencies` in `client/vencord.json`, which adds about 280 KB. Its stylesheet and fonts are served by the instance from `assets/public/katex`, at `/assets/katex/katex.min.css` and `/assets/katex/fonts/`, next to KaTeX's MIT license. The plugin adds the stylesheet the first time it draws a formula, and the browser fetches a font only when a formula uses it. Only the `woff2` fonts are shipped, since every supported browser reads them. Nothing is loaded from a CDN.

After changing the `katex` version in `package.json`, copy the new stylesheet and fonts over the served ones:

```sh
cp node_modules/katex/dist/katex.min.css assets/public/katex/
cp node_modules/katex/dist/fonts/*.woff2 assets/public/katex/fonts/
cp node_modules/katex/LICENSE assets/public/katex/
```

`scripts/tests/markdown-math.test.cjs` fails when the served stylesheet differs from the bundled version. It also covers the delimiters, the fallbacks and the hostile inputs, using `markdown-it` and `markdown-it-dollarmath`, the libraries and options Discord's preview uses.
