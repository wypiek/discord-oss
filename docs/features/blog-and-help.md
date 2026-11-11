# Blog and help centre

The instance has a public blog at `/blog` and a help centre at `/support`. Operators write both in the admin dashboard, under Public pages. The pages are rendered on the server, so link previews and search engines see the full text, and their layout follows discord.com/blog and Discord's help centre. The blog uses the black header and footer of the [homepage](homepage.md). The help centre has a lavender page with a light header, a black "Open <name>" button and a blurple footer. The homepage links to both in its header and footer.

## Blog

| Address | Shows |
| --- | --- |
| `/blog` | The newest featured post in a large card, the next 4 posts in 2 columns and 9 more in 3 columns under Explore further. Below 1280 px Explore further has 2 columns and below 768 px every grid has 1. Load more opens `?page=2`, which shows 12 posts a page. |
| `/blog?q=<words>` | Up to 48 published posts whose title, excerpt or text contains the words, newest first. |
| `/blog/category/<slug>` | The same layout for one category, with its description under the title. |
| `/blog/<slug>` | The cover image, the category as a link to its page, the title, author and date, the post, an author card and up to 3 related posts, from the same category first. |
| `/blog/feed.atom` | An Atom feed of the newest 30 posts. |

A white bar floats 48 px above the bottom of the window on every blog page, 24 px on phones. On listing pages it has a menu of the categories and a search box. On a post the menu lists the post's top level headings, so a reader can jump to a section. A post shows on the blog when it is published and its publish date has passed, so a date in the future schedules it. Publishing a post without a date sets the date to the moment it was published. When no post is featured, the newest post takes the large card. A post without a cover image shows the instance icon on a blue gradient.

| Field | Limit |
| --- | --- |
| Title | 200 characters |
| Slug | 80 characters |
| Excerpt | 500 characters. When it is empty, cards and link previews use the first 220 characters of the post. |
| Body | 100,000 characters of Markdown |
| Author | 80 characters. When it is empty, the post shows the instance name. |
| Category name and description | 60 and 300 characters |

Deleting a category keeps its posts, which then have no category.

## Help centre

| Address | Shows |
| --- | --- |
| `/support` | A search box, the categories as cards with their icon, description and number of articles, and up to 10 articles marked Popular. |
| `/support/categories/<slug>` | Breadcrumbs, a search box and every section of the category with its published articles. |
| `/support/articles/<slug>` | Breadcrumbs, the article with the instance as its author and the date it was last updated, "Was this article helpful?", up to 5 related articles from the other sections of the category or from the Popular ones, and a sidebar with up to 10 articles from the same section. Below 1024 px the sidebar folds into a menu above the article. |
| `/support/search?q=<words>` | Up to 50 published articles whose title or text contains the words, Popular ones first, each with a highlighted snippet. |

A category has a name, a slug, a description of up to 300 characters, an emoji and an optional image that replaces the emoji. Sections group the articles of a category and have only a name. Articles have a title, a slug, a Markdown body of up to 100,000 characters, a published switch and a Popular switch. Deleting a category deletes its sections and articles, and deleting a section deletes its articles.

The Yes and No buttons are a plain form, so they work without JavaScript. Each vote adds 1 to the article's count, and a cookie on `/support` remembers the articles a browser voted on so it can't vote twice. One address can cast 30 votes an hour. The article shows "N out of M found this helpful" once it has a vote.

## Writing

`{instance}` in any title, excerpt, description, author or body shows the instance name, so the text follows `client.instanceName`.

Markdown supports headings, paragraphs, line breaks, **bold**, *italics*, ~~strikethrough~~, inline code, fenced code blocks, quotes, ordered and unordered lists with nesting, horizontal rules, links, bare `https://` links and images. In posts and articles, `#` becomes the second heading level because the title is the first. In help articles a quote shows as a light blue note box with an info mark.

The renderer is written for this project in `src/util/util/Markdown.ts`, so it adds no dependency. It never passes HTML through: every character of the source is escaped, and the output only contains the tags it builds itself, `p`, `br`, `h2` to `h6`, `strong`, `em`, `del`, `code`, `pre`, `blockquote`, `ul`, `ol`, `li`, `hr`, `a` and `img`. A link becomes an `a` only for an `http` or `https` URL or a path on the instance that starts with `/`, `#`, `./` or `../`. Other links, such as `javascript:`, `data:` or `//host`, show as plain text. Links to other sites get `rel="nofollow noopener noreferrer"`. An image becomes an `img` only for a path on the instance or a URL on the instance's CDN, API or server address, so a post can't load a tracking pixel from another site. Its alt text shows otherwise. URLs with spaces, quotes, backslashes or control characters are refused, and the renderer stops matching emphasis and links after 4,000 characters, so long or hostile input renders in linear time.

## Images

Cover images, category images and images inside a post are uploaded from the dashboard through `POST /api/v9/admin/site/images` with a PNG, JPEG, WebP, AVIF or GIF of up to 7 MB. The CDN stores the file under `site-images/<md5>.<extension>` and serves it at `/site-images/<file>`. SVG is refused. The Insert image button in the editor uploads the image and adds `![name](url)` at the cursor.

## Admin dashboard

The Blog page lists the categories in tab order with arrows to reorder them, and every post with its state: Draft, Scheduled or Published. The post drawer has the title, slug, category, author, publish date, excerpt, cover image, the Markdown editor with a Preview button, and the Published and Featured switches.

The Help centre page shows each category as a card with its sections and their articles in order. Arrows reorder categories, sections and articles. Add section and New article open drawers in place, and an article's drawer shows its votes. Delete buttons ask for confirmation and say what else goes with the item.

Both pages need the `OPERATOR` right, like Announcements. The preview runs the same renderer as the public pages through `POST /api/v9/admin/site/preview`.

| Route | Does |
| --- | --- |
| `GET`, `POST`, `PATCH /admin/blog/categories` | List, create and reorder categories. `PATCH` takes `{ "ids": [...] }` in the new order. |
| `PATCH`, `DELETE /admin/blog/categories/:id` | Edit or delete a category. |
| `GET`, `POST /admin/blog/posts` | List posts, drafts included, and create one. |
| `GET`, `PATCH`, `DELETE /admin/blog/posts/:id` | Read, edit or delete a post. |
| `GET`, `POST`, `PATCH /admin/help/categories` | The whole help centre as a tree, create a category, reorder categories. |
| `PATCH`, `DELETE /admin/help/categories/:id` | Edit or delete a category. |
| `POST`, `PATCH /admin/help/sections` | Create a section, reorder the sections of one category. |
| `PATCH`, `DELETE /admin/help/sections/:id` | Rename, move or delete a section. |
| `POST`, `PATCH /admin/help/articles` | Create an article, reorder the articles of one section. |
| `GET`, `PATCH`, `DELETE /admin/help/articles/:id` | Read, edit, move or delete an article. |

## Slugs

A slug is lowercase letters and digits joined by single hyphens, up to 80 characters. An empty slug is made from the title or name: accents are dropped, everything else becomes a hyphen, and `-2`, `-3` and so on are added until it is free. A title without any letter or digit gets `post`, `article` or `category`. A slug typed by hand is cleaned the same way and refused with HTTP 400 when another item already has it. Changing a title keeps the slug, so links stay valid.

## First start

The migration that creates the tables writes starter content when the tables are empty: a Company category with a welcome post, and a help centre with 4 categories, Getting started, Account and security, Encryption, and Servers and chat, with 11 short articles. Deleting them later doesn't bring them back.

## Workers

On Cloudflare Workers the router sends `/blog` and `/support` to the API worker, which bundles `assets/public/site.html`. The CDN worker stores and serves `site-images`.
