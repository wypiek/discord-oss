"use strict";

const SITE_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/avif";
const SITE_IMAGE_MAX_BYTES = 7 * 1024 * 1024;

const uploadSiteImage = async (file) => {
  if (!file) return null;
  if (file.size > SITE_IMAGE_MAX_BYTES) throw new Error("Choose an image smaller than 7 MB.");
  return api("/admin/site/images", { method: "POST", body: { image: await readAsDataUrl(file) } });
};

const moveInList = (ids, id, step) => {
  const next = [...ids];
  const index = next.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= next.length) return null;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

const orderButtons = (kind, id, index, count, label) =>
  html`<span class="order-buttons">
    <button class="btn ghost small" type="button" data-move="${kind}" data-id="${id}" data-step="-1" aria-label="Move ${label} up" ${index === 0 ? raw("disabled") : ""}>↑</button>
    <button class="btn ghost small" type="button" data-move="${kind}" data-id="${id}" data-step="1" aria-label="Move ${label} down" ${index === count - 1 ? raw("disabled") : ""}>↓</button>
  </span>`;

const publishBadge = (item) => {
  if (!item.published) return html`<span class="badge">Draft</span>`;
  if (item.published_at && new Date(item.published_at) > new Date())
    return html`<span class="badge info">Scheduled</span>`;
  return html`<span class="badge ok">Published</span>`;
};

const markdownEditor = (name, value, label, hint) =>
  html`<div class="md-editor" data-md-editor>
    <div class="row md-toolbar">
      <span class="md-label" id="${name}-label">${label}</span>
      <span class="grow"></span>
      <label class="btn small md-image-button">Insert image<input type="file" accept="${SITE_IMAGE_TYPES}" data-md-image hidden /></label>
      <button class="btn small" type="button" data-md-preview aria-pressed="false">Preview</button>
    </div>
    <textarea name="${name}" rows="18" maxlength="100000" spellcheck="true" aria-labelledby="${name}-label" data-md-source>${value ?? ""}</textarea>
    <div class="md-preview" data-md-output hidden></div>
    <span class="hint">${hint ?? raw("Markdown: # headings, **bold**, *italics*, [links](https://…), lists, &gt; quotes and `code`. HTML isn't allowed. {instance} shows the instance name.")}</span>
  </div>`;

const bindMarkdownEditor = (root) => {
  for (const editor of $$("[data-md-editor]", root)) {
    const source = $("[data-md-source]", editor);
    const output = $("[data-md-output]", editor);
    const toggle = $("[data-md-preview]", editor);
    const imageInput = $("[data-md-image]", editor);
    toggle.addEventListener("click", async () => {
      const showing = toggle.getAttribute("aria-pressed") === "true";
      if (showing) {
        toggle.setAttribute("aria-pressed", "false");
        toggle.textContent = "Preview";
        output.hidden = true;
        source.hidden = false;
        source.focus();
        return;
      }
      const result = await act(toggle, () =>
        api("/admin/site/preview", { method: "POST", body: { markdown: source.value } }),
      );
      if (!result) return;
      output.innerHTML = result.html || "<p class=\"muted\">Nothing to preview yet.</p>";
      output.hidden = false;
      source.hidden = true;
      toggle.setAttribute("aria-pressed", "true");
      toggle.textContent = "Edit";
    });
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files[0];
      imageInput.value = "";
      if (!file) return;
      const uploaded = await act(imageInput.closest("label"), () => uploadSiteImage(file), "Image uploaded");
      if (!uploaded) return;
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[[\]()]/g, "");
      const snippet = `![${alt}](${uploaded.url})`;
      const start = source.selectionStart ?? source.value.length;
      const end = source.selectionEnd ?? start;
      const before = source.value.slice(0, start);
      const prefix = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
      source.setRangeText(`${prefix}${snippet}\n\n`, start, end, "end");
      source.dispatchEvent(new Event("input", { bubbles: true }));
      source.focus();
    });
  }
};

const imagePicker = (name, label, current, hint) =>
  html`<div class="stack image-picker" data-image-picker="${name}">
    <span class="md-label">${label}</span>
    <div class="row">
      <span class="image-picker-preview" data-image-preview>${
        current?.url ? html`<img src="${current.url}" alt="" />` : html`<span class="muted">No image</span>`
      }</span>
      <div class="stack grow" style="gap:8px">
        <label class="btn small" style="align-self:flex-start">Upload image<input type="file" accept="${SITE_IMAGE_TYPES}" data-image-input hidden /></label>
        <button class="btn ghost small" type="button" data-image-remove style="align-self:flex-start" ${current?.id ? "" : raw("hidden")}>Remove image</button>
        <span class="hint">${hint}</span>
      </div>
    </div>
  </div>`;

const bindImagePicker = (root, name, state) => {
  const picker = $(`[data-image-picker="${name}"]`, root);
  const preview = $("[data-image-preview]", picker);
  const input = $("[data-image-input]", picker);
  const remove = $("[data-image-remove]", picker);
  const show = () => {
    mount(preview, state[name]?.url ? html`<img src="${state[name].url}" alt="" />` : html`<span class="muted">No image</span>`);
    remove.hidden = !state[name]?.id;
  };
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    const uploaded = await act(input.closest("label"), () => uploadSiteImage(file), "Image uploaded");
    if (!uploaded) return;
    state[name] = uploaded;
    picker.closest("form").dataset.dirty = "true";
    show();
  });
  remove.addEventListener("click", () => {
    state[name] = null;
    picker.closest("form").dataset.dirty = "true";
    show();
  });
};

const bindMoves = (view, handlers) => {
  for (const button of $$("[data-move]", view))
    button.addEventListener("click", async () => {
      const handler = handlers[button.dataset.move];
      if (!handler) return;
      await handler(button, button.dataset.id, Number(button.dataset.step));
    });
};

const deleteButton = (id, label) =>
  html`<button class="btn danger" id="${id}" type="button" style="margin-right:auto">${label}</button>`;


async function renderBlogAdmin(view) {
  const [categories, { posts, total }] = await Promise.all([
    api("/admin/blog/categories"),
    api("/admin/blog/posts?limit=200"),
  ]);
  const categoryName = (id) => categories.find((c) => c.id === id)?.name ?? "—";
  mount(
    view,
    html`
      <div class="page-head">
        <div>
          <h1>Blog</h1>
          <p class="muted">Posts and categories on the public <a href="/blog" target="_blank" rel="noopener">blog</a>. Drafts and posts scheduled for later stay hidden until their time comes.</p>
        </div>
        <div class="row">
          <button class="btn" id="new-blog-category" type="button">New category</button>
          <button class="btn primary" id="new-blog-post" type="button">Write a post</button>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="row" style="justify-content:space-between;margin-bottom:8px">
            <h2>Categories</h2>
            <span class="muted">Shown as tabs on the blog, in this order.</span>
          </div>
          ${
            categories.length
              ? html`<ul class="site-list">
                  ${categories.map(
                    (category, index) =>
                      html`<li data-id="${category.id}" data-kind="blog-category">
                        <div class="grow">
                          <strong>${category.name}</strong>
                          <span class="muted"> /blog/category/${category.slug} · ${category.posts} ${category.posts === 1 ? "post" : "posts"}</span>
                        </div>
                        ${orderButtons("blog-category", category.id, index, categories.length, category.name)}
                        <button class="btn small" type="button" data-edit-category="${category.id}">Edit</button>
                      </li>`,
                  )}
                </ul>`
              : html`<p class="muted">No categories yet. Posts without a category still show on the blog.</p>`
          }
        </div>
        ${
          posts.length
            ? html`<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Post</th>
                      <th class="hide-sm">Category</th>
                      <th>State</th>
                      <th class="hide-sm">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${posts.map(
                      (post) =>
                        html`<tr data-id="${post.id}">
                          <td>
                            <div class="ident">
                              ${post.cover_image_url ? html`<img class="site-thumb" src="${post.cover_image_url}" alt="" />` : html`<span class="site-thumb"></span>`}
                              <div><strong>${post.title}</strong>${post.featured ? html` <span class="badge accent">Featured</span>` : ""}<div class="muted">/blog/${post.slug}</div></div>
                            </div>
                          </td>
                          <td class="hide-sm">${categoryName(post.category_id)}</td>
                          <td>${publishBadge(post)}</td>
                          <td class="hide-sm">${post.published_at ? fmtDay(post.published_at) : html`<span class="muted">Edited ${fmtDay(post.updated_at)}</span>`}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              ${total > posts.length ? html`<p class="muted">Showing the newest ${posts.length} of ${total} posts.</p>` : ""}`
            : emptyCard("No posts yet. Write the first one, save it as a draft and publish it when it's ready.", "Write a post")
        }
      </div>
    `,
  );
  const refresh = () => renderBlogAdmin(view);
  $("#new-blog-post").addEventListener("click", () => openBlogPost(null, categories, refresh));
  $("#new-blog-category").addEventListener("click", () => openBlogCategory(null, refresh));
  $("[data-empty-action]", view)?.addEventListener("click", () => openBlogPost(null, categories, refresh));
  for (const button of $$("[data-edit-category]", view))
    button.addEventListener("click", () =>
      openBlogCategory(categories.find((c) => c.id === button.dataset.editCategory), refresh),
    );
  for (const row of $$("tbody tr", view))
    onRowOpen(row, () => openBlogPost(posts.find((p) => p.id === row.dataset.id), categories, refresh));
  bindMoves(view, {
    "blog-category": async (button, id, step) => {
      const ids = moveInList(categories.map((c) => c.id), id, step);
      if (!ids) return;
      const done = await act(button, () => api("/admin/blog/categories", { method: "PATCH", body: { ids } }), "Order saved");
      if (done) refresh();
    },
  });
}

function openBlogCategory(category, refresh) {
  const body = openDrawer(
    category ? "Edit category" : "New category",
    html`<form id="blog-category-form" class="stack">
      <label>Name<input name="name" required maxlength="60" value="${category?.name ?? ""}" placeholder="Company" /></label>
      <label>Slug<span class="hint">The address is /blog/category/<em>slug</em>. Leave it empty to make one from the name.</span><input name="slug" maxlength="80" value="${category?.slug ?? ""}" placeholder="company" pattern="[A-Za-z0-9 -]*" /></label>
      <label>Description<span class="hint">Optional. Shown under the category's title.</span><textarea name="description" maxlength="300" rows="3">${category?.description ?? ""}</textarea></label>
      <div class="form-actions">
        ${category ? deleteButton("blog-category-delete", "Delete category") : ""}
        <button class="btn primary" type="submit">${category ? "Save category" : "Create category"}</button>
      </div>
    </form>`,
  );
  if (!body) return;
  const form = $("#blog-category-form", body);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = { name: form.name.value, slug: form.slug.value, description: form.description.value };
    const done = await act(
      $("button[type=submit]", form),
      () =>
        category
          ? api(`/admin/blog/categories/${category.id}`, { method: "PATCH", body: payload })
          : api("/admin/blog/categories", { method: "POST", body: payload }),
      category ? "Category saved" : "Category created",
    );
    if (done) {
      closeDrawer();
      refresh();
    }
  });
  $("#blog-category-delete", body)?.addEventListener("click", async (event) => {
    if (
      !(await confirmDialog({
        title: `Delete the "${category.name}" category?`,
        message: category.posts
          ? `Its ${category.posts} ${category.posts === 1 ? "post stays" : "posts stay"} on the blog without a category.`
          : "",
        confirm: "Delete category",
      }))
    )
      return;
    const done = await act(event.currentTarget, () => api(`/admin/blog/categories/${category.id}`, { method: "DELETE" }), "Category deleted");
    if (done !== undefined) {
      closeDrawer();
      refresh();
    }
  });
}

async function openBlogPost(summary, categories, refresh) {
  const post = summary ? await api(`/admin/blog/posts/${summary.id}`).catch((e) => toast(e.message, "error")) : null;
  if (summary && !post) return;
  const images = { cover: post?.cover_image ? { id: post.cover_image, url: post.cover_image_url } : null };
  const body = openDrawer(
    post ? "Edit post" : "Write a post",
    html`<form id="blog-post-form" class="stack">
      <label>Title<input name="title" required maxlength="200" value="${post?.title ?? ""}" placeholder="What's new on {instance}" /></label>
      <div class="form-grid">
        <label>Slug<span class="hint">The address is /blog/<em>slug</em>. Empty makes one from the title.</span><input name="slug" maxlength="80" value="${post?.slug ?? ""}" /></label>
        <label>Category<select name="category_id">${options([["", "No category"], ...categories.map((c) => [c.id, c.name])], post?.category_id ?? "")}</select></label>
        <label>Author<span class="hint">Shown under the title. Empty shows the instance name.</span><input name="author_name" maxlength="80" value="${post?.author_name ?? ""}" placeholder="The {instance} team" /></label>
        <label>Publish date<span class="hint">Empty publishes now. A later date schedules the post.</span><input name="published_at" type="datetime-local" value="${toLocalInput(post?.published_at)}" /></label>
      </div>
      <label>Excerpt<span class="hint">One or two sentences for cards and link previews. Empty uses the start of the post.</span><textarea name="excerpt" maxlength="500" rows="3">${post?.excerpt ?? ""}</textarea></label>
      ${imagePicker("cover", "Cover image", images.cover, "Wide images work best, about 2.5 to 1. Without one the card shows the instance icon.")}
      ${markdownEditor("body", post?.body, "Post")}
      <label class="toggle"><input type="checkbox" name="published" ${post?.published ? raw("checked") : ""} /><span>Published<span class="hint">Shown on the blog from the publish date on.</span></span></label>
      <label class="toggle"><input type="checkbox" name="featured" ${post?.featured ? raw("checked") : ""} /><span>Featured<span class="hint">The newest featured post fills the large card at the top of the blog and its category.</span></span></label>
      <div class="form-actions">
        ${post ? deleteButton("blog-post-delete", "Delete post") : ""}
        ${post?.published ? html`<a class="btn ghost" href="${post.url}" target="_blank" rel="noopener">View post ↗</a>` : ""}
        <button class="btn primary" type="submit">${post ? "Save post" : "Save post"}</button>
      </div>
    </form>`,
  );
  if (!body) return;
  const form = $("#blog-post-form", body);
  bindMarkdownEditor(form);
  bindImagePicker(form, "cover", images);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: form.title.value,
      slug: form.slug.value,
      category_id: form.category_id.value || null,
      author_name: form.author_name.value,
      excerpt: form.excerpt.value,
      body: form.body.value,
      cover_image: images.cover?.id ?? null,
      published: form.published.checked,
      featured: form.featured.checked,
      published_at: fromLocalInput(form.published_at.value),
    };
    const done = await act(
      $("button[type=submit]", form),
      () =>
        post
          ? api(`/admin/blog/posts/${post.id}`, { method: "PATCH", body: payload })
          : api("/admin/blog/posts", { method: "POST", body: payload }),
      payload.published ? "Post saved and published" : "Draft saved",
    );
    if (done) {
      closeDrawer();
      refresh();
    }
  });
  $("#blog-post-delete", body)?.addEventListener("click", async (event) => {
    if (!(await confirmDialog({ title: `Delete "${post.title}"?`, message: "The post and its address stop working right away.", confirm: "Delete post" }))) return;
    const done = await act(event.currentTarget, () => api(`/admin/blog/posts/${post.id}`, { method: "DELETE" }), "Post deleted");
    if (done !== undefined) {
      closeDrawer();
      refresh();
    }
  });
}


const changelogBadge = (changelog) => {
  if (!changelog.published) return html`<span class="badge">Draft</span>`;
  if (changelog.scheduled) return html`<span class="badge info">Scheduled</span>`;
  return html`<span class="badge ok">Published</span>`;
};

async function renderChangelogAdmin(view) {
  const changelogs = await api("/admin/changelogs");
  const live = changelogs.find((changelog) => changelog.published && !changelog.scheduled);
  mount(
    view,
    html`
      <div class="page-head">
        <div>
          <h1>What's New</h1>
          <p class="muted">Changelogs shown in the app's What's New window. The newest published one opens by itself for people who haven't seen it, when "Show on startup" is on.</p>
        </div>
        <div class="row">
          <button class="btn primary" id="new-changelog" type="button">Write a changelog</button>
        </div>
      </div>
      ${
        changelogs.length
          ? html`<div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Changelog</th>
                    <th>State</th>
                    <th class="hide-sm">Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${changelogs.map(
                    (changelog) =>
                      html`<tr data-id="${changelog.id}">
                        <td>
                          <div class="ident">
                            ${changelog.image_url ? html`<img class="site-thumb" src="${changelog.image_url}" alt="" />` : html`<span class="site-thumb"></span>`}
                            <div>
                              <strong>${changelog.title}</strong>${changelog.id === live?.id ? html` <span class="badge accent">Showing now</span>` : ""}
                              <div class="muted">${changelog.youtube_video_id ? "YouTube video" : changelog.image ? "Image" : "No media"}${changelog.show_on_startup ? " · opens on startup" : ""}</div>
                            </div>
                          </div>
                        </td>
                        <td>${changelogBadge(changelog)}</td>
                        <td class="hide-sm">${changelog.date}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
          : emptyCard("No changelogs yet. Write one to tell people what changed.", "Write a changelog")
      }
    `,
  );
  const refresh = () => renderChangelogAdmin(view);
  $("#new-changelog").addEventListener("click", () => openChangelog(null, refresh));
  $("[data-empty-action]", view)?.addEventListener("click", () => openChangelog(null, refresh));
  for (const row of $$("tbody tr", view)) onRowOpen(row, () => openChangelog(changelogs.find((c) => c.id === row.dataset.id), refresh));
}

function openChangelog(changelog, refresh) {
  const images = { image: changelog?.image ? { id: changelog.image, url: changelog.image_url } : null };
  const body = openDrawer(
    changelog ? "Edit changelog" : "Write a changelog",
    html`<form id="changelog-form" class="stack">
      <label>Title<span class="hint">Only shown here in the dashboard. Put the heading people see at the top of the changelog.</span><input name="title" required maxlength="200" value="${changelog?.title ?? ""}" placeholder="November update" /></label>
      <label>Date<span class="hint">Shown in the What's New window. A later date keeps it hidden until that day.</span><input name="date" type="date" required value="${changelog?.date ?? new Date().toISOString().slice(0, 10)}" /></label>
      ${imagePicker("image", "Image", images.image, "Shown at the top of the window. Wide images work best, about 16 to 9.")}
      <label>YouTube video<span class="hint">Instead of an image, a YouTube link or video id plays at the top of the window.</span><input name="youtube_video_id" maxlength="200" value="${changelog?.youtube_video_id ?? ""}" placeholder="https://www.youtube.com/watch?v=…" /></label>
      ${markdownEditor("body", changelog?.body, "Changelog", "Markdown: # headings, **bold**, *italics*, [links](https://…), lists and > quotes. {instance} shows the instance name. Pictures inside the text don't show in the app, so use the Image field above.")}
      <label class="toggle"><input type="checkbox" name="published" ${changelog?.published ? raw("checked") : ""} /><span>Published<span class="hint">Shown in the app from its date on.</span></span></label>
      <label class="toggle"><input type="checkbox" name="show_on_startup" ${changelog?.show_on_startup ?? true ? raw("checked") : ""} /><span>Show on startup<span class="hint">When this is the newest published changelog, the window opens by itself once for everyone who hasn't seen it.</span></span></label>
      <div class="form-actions">
        ${changelog ? deleteButton("changelog-delete", "Delete changelog") : ""}
        <button class="btn primary" type="submit">Save changelog</button>
      </div>
    </form>`,
  );
  if (!body) return;
  const form = $("#changelog-form", body);
  bindMarkdownEditor(form);
  bindImagePicker(form, "image", images);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: form.title.value,
      date: form.date.value,
      body: form.body.value,
      image: images.image?.id ?? null,
      youtube_video_id: form.youtube_video_id.value || null,
      published: form.published.checked,
      show_on_startup: form.show_on_startup.checked,
    };
    const done = await act(
      $("button[type=submit]", form),
      () =>
        changelog
          ? api(`/admin/changelogs/${changelog.id}`, { method: "PATCH", body: payload })
          : api("/admin/changelogs", { method: "POST", body: payload }),
      payload.published ? "Changelog saved and published" : "Draft saved",
    );
    if (done) {
      closeDrawer();
      refresh();
    }
  });
  $("#changelog-delete", body)?.addEventListener("click", async (event) => {
    if (!(await confirmDialog({ title: `Delete "${changelog.title}"?`, message: "It disappears from What's New right away.", confirm: "Delete changelog" }))) return;
    const done = await act(event.currentTarget, () => api(`/admin/changelogs/${changelog.id}`, { method: "DELETE" }), "Changelog deleted");
    if (done !== undefined) {
      closeDrawer();
      refresh();
    }
  });
}

const helpfulLabel = (article) => {
  const total = article.helpful_yes + article.helpful_no;
  return total ? `${article.helpful_yes} of ${total} found it helpful` : "No votes yet";
};

async function renderHelpAdmin(view) {
  const tree = await api("/admin/help/categories");
  const sections = tree.flatMap((category) => category.sections.map((section) => ({ ...section, category })));
  const articles = sections.flatMap((section) => section.articles.map((article) => ({ ...article, section })));
  mount(
    view,
    html`
      <div class="page-head">
        <div>
          <h1>Help centre</h1>
          <p class="muted">Categories, sections and articles on the public <a href="/support" target="_blank" rel="noopener">help centre</a>. Drafts stay hidden until you publish them.</p>
        </div>
        <div class="row">
          <button class="btn primary" id="new-help-category" type="button">New category</button>
        </div>
      </div>
      ${
        tree.length
          ? html`<div class="stack">
              ${tree.map(
                (category, categoryIndex) => html`<section class="card help-category" aria-labelledby="help-category-${category.id}">
                  <div class="row help-category-head">
                    <span class="help-icon">${category.icon_image_url ? html`<img src="${category.icon_image_url}" alt="" />` : category.icon || "📘"}</span>
                    <div class="grow">
                      <h2 id="help-category-${category.id}">${category.name}</h2>
                      <span class="muted">/support/categories/${category.slug}</span>
                    </div>
                    ${orderButtons("help-category", category.id, categoryIndex, tree.length, category.name)}
                    <button class="btn small" type="button" data-edit-help-category="${category.id}">Edit</button>
                    <button class="btn small" type="button" data-new-section="${category.id}">Add section</button>
                  </div>
                  ${
                    category.sections.length
                      ? category.sections.map(
                          (section, sectionIndex) => html`<div class="help-section">
                            <div class="row help-section-head">
                              <h3 class="grow">${section.name}</h3>
                              ${orderButtons("help-section", section.id, sectionIndex, category.sections.length, section.name)}
                              <button class="btn ghost small" type="button" data-edit-section="${section.id}">Edit</button>
                              <button class="btn small" type="button" data-new-article="${section.id}">New article</button>
                            </div>
                            ${
                              section.articles.length
                                ? html`<ul class="site-list">
                                    ${section.articles.map(
                                      (article, articleIndex) => html`<li data-article="${article.id}">
                                        <div class="grow">
                                          <strong>${article.title}</strong>
                                          ${article.published ? "" : html` <span class="badge">Draft</span>`}
                                          ${article.promoted ? html` <span class="badge accent">Popular</span>` : ""}
                                          <div class="muted">${helpfulLabel(article)} · updated ${fmtDay(article.updated_at)}</div>
                                        </div>
                                        ${orderButtons("help-article", article.id, articleIndex, section.articles.length, article.title)}
                                      </li>`,
                                    )}
                                  </ul>`
                                : html`<p class="muted">No articles in this section yet.</p>`
                            }
                          </div>`,
                        )
                      : html`<p class="muted">Add a section to start writing articles in this category.</p>`
                  }
                </section>`,
              )}
            </div>`
          : emptyCard("The help centre is empty. Create a category, add a section to it and write the first article.", "New category")
      }
    `,
  );
  const refresh = () => renderHelpAdmin(view);
  const openCategory = (category) => openHelpCategory(category, refresh);
  $("#new-help-category").addEventListener("click", () => openCategory(null));
  $("[data-empty-action]", view)?.addEventListener("click", () => openCategory(null));
  for (const button of $$("[data-edit-help-category]", view))
    button.addEventListener("click", () => openCategory(tree.find((c) => c.id === button.dataset.editHelpCategory)));
  for (const button of $$("[data-new-section]", view))
    button.addEventListener("click", () => openHelpSection(null, button.dataset.newSection, tree, refresh));
  for (const button of $$("[data-edit-section]", view))
    button.addEventListener("click", () => {
      const section = sections.find((s) => s.id === button.dataset.editSection);
      openHelpSection(section, section.category_id, tree, refresh);
    });
  for (const button of $$("[data-new-article]", view))
    button.addEventListener("click", () => openHelpArticle(null, button.dataset.newArticle, tree, refresh));
  for (const row of $$("[data-article]", view))
    onRowOpen(row, () => {
      const article = articles.find((a) => a.id === row.dataset.article);
      openHelpArticle(article, article.section_id, tree, refresh);
    });
  const reorder = (path, siblings) => async (button, id, step) => {
    const ids = moveInList(siblings(id).map((item) => item.id), id, step);
    if (!ids) return;
    const done = await act(button, () => api(path, { method: "PATCH", body: { ids } }), "Order saved");
    if (done) refresh();
  };
  bindMoves(view, {
    "help-category": reorder("/admin/help/categories", () => tree),
    "help-section": reorder("/admin/help/sections", (id) => sections.find((s) => s.id === id).category.sections),
    "help-article": reorder("/admin/help/articles", (id) => articles.find((a) => a.id === id).section.articles),
  });
}

function openHelpCategory(category, refresh) {
  const images = { icon: category?.icon_image ? { id: category.icon_image, url: category.icon_image_url } : null };
  const articleCount = category ? category.sections.reduce((sum, s) => sum + s.articles.length, 0) : 0;
  const body = openDrawer(
    category ? "Edit category" : "New category",
    html`<form id="help-category-form" class="stack">
      <label>Name<input name="name" required maxlength="80" value="${category?.name ?? ""}" placeholder="Getting started" /></label>
      <label>Slug<span class="hint">The address is /support/categories/<em>slug</em>. Empty makes one from the name.</span><input name="slug" maxlength="80" value="${category?.slug ?? ""}" /></label>
      <label>Description<span class="hint">Shown on the category's card and page.</span><textarea name="description" maxlength="300" rows="3">${category?.description ?? ""}</textarea></label>
      <label>Emoji<span class="hint">Shown on the card when there's no image.</span><input name="icon" maxlength="16" value="${category?.icon ?? ""}" placeholder="👋" style="max-width:120px" /></label>
      ${imagePicker("icon", "Icon image", images.icon, "Optional. A square image replaces the emoji.")}
      <div class="form-actions">
        ${category ? deleteButton("help-category-delete", "Delete category") : ""}
        <button class="btn primary" type="submit">${category ? "Save category" : "Create category"}</button>
      </div>
    </form>`,
  );
  if (!body) return;
  const form = $("#help-category-form", body);
  bindImagePicker(form, "icon", images);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      name: form.name.value,
      slug: form.slug.value,
      description: form.description.value,
      icon: form.icon.value,
      icon_image: images.icon?.id ?? null,
    };
    const done = await act(
      $("button[type=submit]", form),
      () =>
        category
          ? api(`/admin/help/categories/${category.id}`, { method: "PATCH", body: payload })
          : api("/admin/help/categories", { method: "POST", body: payload }),
      category ? "Category saved" : "Category created",
    );
    if (done) {
      closeDrawer();
      refresh();
    }
  });
  $("#help-category-delete", body)?.addEventListener("click", async (event) => {
    if (
      !(await confirmDialog({
        title: `Delete the "${category.name}" category?`,
        message: `This also deletes its ${category.sections.length} ${category.sections.length === 1 ? "section" : "sections"} and ${articleCount} ${articleCount === 1 ? "article" : "articles"}.`,
        confirm: "Delete category",
      }))
    )
      return;
    const done = await act(event.currentTarget, () => api(`/admin/help/categories/${category.id}`, { method: "DELETE" }), "Category deleted");
    if (done !== undefined) {
      closeDrawer();
      refresh();
    }
  });
}

function openHelpSection(section, categoryId, tree, refresh) {
  const body = openDrawer(
    section ? "Edit section" : "Add section",
    html`<form id="help-section-form" class="stack">
      <label>Name<input name="name" required maxlength="120" value="${section?.name ?? ""}" placeholder="Your account" /></label>
      <label>Category<select name="category_id">${options(tree.map((c) => [c.id, c.name]), categoryId)}</select></label>
      <div class="form-actions">
        ${section ? deleteButton("help-section-delete", "Delete section") : ""}
        <button class="btn primary" type="submit">${section ? "Save section" : "Add section"}</button>
      </div>
    </form>`,
  );
  if (!body) return;
  const form = $("#help-section-form", body);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = { name: form.name.value, category_id: form.category_id.value };
    const done = await act(
      $("button[type=submit]", form),
      () =>
        section
          ? api(`/admin/help/sections/${section.id}`, { method: "PATCH", body: payload })
          : api("/admin/help/sections", { method: "POST", body: payload }),
      section ? "Section saved" : "Section added",
    );
    if (done) {
      closeDrawer();
      refresh();
    }
  });
  $("#help-section-delete", body)?.addEventListener("click", async (event) => {
    const count = section.articles.length;
    if (
      !(await confirmDialog({
        title: `Delete the "${section.name}" section?`,
        message: count ? `This also deletes its ${count} ${count === 1 ? "article" : "articles"}.` : "",
        confirm: "Delete section",
      }))
    )
      return;
    const done = await act(event.currentTarget, () => api(`/admin/help/sections/${section.id}`, { method: "DELETE" }), "Section deleted");
    if (done !== undefined) {
      closeDrawer();
      refresh();
    }
  });
}

async function openHelpArticle(summary, sectionId, tree, refresh) {
  const article = summary ? await api(`/admin/help/articles/${summary.id}`).catch((e) => toast(e.message, "error")) : null;
  if (summary && !article) return;
  const sectionOptions = tree.map(
    (category) =>
      html`<optgroup label="${category.name}">${options(category.sections.map((s) => [s.id, s.name]), sectionId)}</optgroup>`,
  );
  const body = openDrawer(
    article ? "Edit article" : "New article",
    html`<form id="help-article-form" class="stack">
      <label>Title<input name="title" required maxlength="200" value="${article?.title ?? ""}" placeholder="Turning on notifications" /></label>
      <div class="form-grid">
        <label>Slug<span class="hint">The address is /support/articles/<em>slug</em>. Empty makes one from the title.</span><input name="slug" maxlength="80" value="${article?.slug ?? ""}" /></label>
        <label>Section<select name="section_id">${sectionOptions}</select></label>
      </div>
      ${markdownEditor("body", article?.body, "Article")}
      <label class="toggle"><input type="checkbox" name="published" ${article?.published ? raw("checked") : ""} /><span>Published<span class="hint">Shown in the help centre and its search.</span></span></label>
      <label class="toggle"><input type="checkbox" name="promoted" ${article?.promoted ? raw("checked") : ""} /><span>Popular<span class="hint">Listed under Popular articles on the help centre's front page.</span></span></label>
      ${article ? html`<p class="muted">${helpfulLabel(article)}.</p>` : ""}
      <div class="form-actions">
        ${article ? deleteButton("help-article-delete", "Delete article") : ""}
        ${article?.published ? html`<a class="btn ghost" href="${article.url}" target="_blank" rel="noopener">View article ↗</a>` : ""}
        <button class="btn primary" type="submit">Save article</button>
      </div>
    </form>`,
  );
  if (!body) return;
  const form = $("#help-article-form", body);
  bindMarkdownEditor(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: form.title.value,
      slug: form.slug.value,
      section_id: form.section_id.value,
      body: form.body.value,
      published: form.published.checked,
      promoted: form.promoted.checked,
    };
    const done = await act(
      $("button[type=submit]", form),
      () =>
        article
          ? api(`/admin/help/articles/${article.id}`, { method: "PATCH", body: payload })
          : api("/admin/help/articles", { method: "POST", body: payload }),
      payload.published ? "Article saved and published" : "Draft saved",
    );
    if (done) {
      closeDrawer();
      refresh();
    }
  });
  $("#help-article-delete", body)?.addEventListener("click", async (event) => {
    if (!(await confirmDialog({ title: `Delete "${article.title}"?`, message: "The article and its votes are removed for good.", confirm: "Delete article" }))) return;
    const done = await act(event.currentTarget, () => api(`/admin/help/articles/${article.id}`, { method: "DELETE" }), "Article deleted");
    if (done !== undefined) {
      closeDrawer();
      refresh();
    }
  });
}

TABS.blog = renderBlogAdmin;
TABS.changelogs = renderChangelogAdmin;
TABS.help = renderHelpAdmin;
