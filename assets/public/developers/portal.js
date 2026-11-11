(() => {
  const config = JSON.parse(document.getElementById("portal-config").textContent);
  const token = (() => {
    try {
      return JSON.parse(localStorage.getItem("token") ?? "null");
    } catch {
      return null;
    }
  })();
  if (!token) {
    location.replace(`/login?redirect_to=${encodeURIComponent(location.pathname)}`);
    return;
  }

  const view = document.getElementById("view");
  const pendingTokens = new Map();
  const pendingBotTokenResets = new Set();
  let currentBotToken = null;
  const pendingClientSecrets = new Map();
  const pendingClientSecretResets = new Set();
  let currentClientSecret = null;
  let renderVersion = 0;
  let widgetRequestVersion = 0;
  const nav = document.getElementById("nav");
  document.getElementById("brand-name").textContent = config.instanceName;
  if (config.icon) document.getElementById("brand-icon").src = config.icon;

  const PERMISSIONS = [
    [
      "General permissions",
      [
        ["Administrator", 3],
        ["View audit log", 7],
        ["Manage server", 5],
        ["Manage roles", 28],
        ["Manage channels", 4],
        ["Kick members", 1],
        ["Ban members", 2],
        ["Moderate members", 40],
        ["Create invite", 0],
        ["Change nickname", 26],
        ["Manage nicknames", 27],
        ["Manage expressions", 30],
        ["Manage webhooks", 29],
        ["Manage events", 33],
        ["View channels", 10],
      ],
    ],
    [
      "Text permissions",
      [
        ["Send messages", 11],
        ["Send messages in threads", 38],
        ["Create public threads", 35],
        ["Create private threads", 36],
        ["Manage messages", 13],
        ["Manage threads", 34],
        ["Embed links", 14],
        ["Attach files", 15],
        ["Read message history", 16],
        ["Mention everyone", 17],
        ["Use external emojis", 18],
        ["Use external stickers", 37],
        ["Add reactions", 6],
        ["Use slash commands", 31],
        ["Create polls", 49],
        ["Send text-to-speech messages", 12],
      ],
    ],
    [
      "Voice permissions",
      [
        ["Connect", 20],
        ["Speak", 21],
        ["Video", 9],
        ["Use voice activity", 25],
        ["Priority speaker", 8],
        ["Mute members", 22],
        ["Deafen members", 23],
        ["Move members", 24],
      ],
    ],
  ];

  const SCOPES = [
    "identify",
    "email",
    "connections",
    "guilds",
    "guilds.join",
    "guilds.members.read",
    "gdm.join",
    "bot",
    "applications.commands",
    "applications.commands.permissions.update",
    "applications.entitlements",
    "role_connections.write",
    "webhook.incoming",
    "messages.read",
    "dm_channels.read",
    "relationships.read",
    "activities.read",
    "activities.write",
    "voice",
    "rpc",
    "rpc.activities.write",
    "rpc.voice.read",
    "rpc.voice.write",
    "openid",
  ];

  const FLAGS = { publicClient: 1 << 8, embedded: 1 << 17, embeddedReleased: 1 << 1 };

  const INTENTS = [
    [
      "presence",
      "Presence intent",
      "Required for your bot to receive presence update events.",
      1 << 13,
    ],
    [
      "members",
      "Server members intent",
      "Required for your bot to receive events listed under GUILD_MEMBERS.",
      1 << 15,
    ],
    [
      "content",
      "Message content intent",
      "Required for your bot to receive message content in most messages.",
      1 << 19,
    ],
  ];

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "class") node.className = value;
      else if (key === "value") node.value = value;
      else if (key === "checked") node.checked = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter((child) => child != null && child !== false));
    return node;
  };

  const errorText = (body, status) => {
    const walk = (node) => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node._errors) && node._errors[0]?.message) return node._errors[0].message;
      for (const value of Object.values(node)) {
        const found = walk(value);
        if (found) return found;
      }
      return null;
    };
    return walk(body?.errors) ?? body?.message ?? `The request failed with status ${status}.`;
  };

  const api = async (method, path, body) => {
    const res = await fetch(`/api/v9${path}`, {
      method,
      headers: {
        authorization: token,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
      location.replace(`/login?redirect_to=${encodeURIComponent(location.pathname)}`);
      throw new Error("Your session has expired.");
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok)
      throw Object.assign(new Error(errorText(data, res.status)), {
        field: Object.keys(data?.errors ?? {})[0],
      });
    return data;
  };

  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const iconUrl = (app) =>
    app.icon ? `${config.cdn}/app-icons/${app.id}/${app.icon}.png?size=256` : null;
  const avatarUrl = (user) =>
    user?.avatar ? `${config.cdn}/avatars/${user.id}/${user.avatar}.png?size=256` : null;

  const appIcon = (app, size = "") => {
    const src = iconUrl(app);
    return src
      ? el("img", { class: `app-icon ${size}`, src, alt: "" })
      : el(
          "span",
          { class: `app-icon ${size}`, "aria-hidden": "true" },
          (app.name ?? "?").trim().charAt(0).toUpperCase() || "?",
        );
  };

  const navigate = (path, replace = false) => {
    history[replace ? "replaceState" : "pushState"](null, "", path);
    render();
  };

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-link]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(link.getAttribute("href"));
  });
  window.addEventListener("popstate", () => render());

  const copyButton = (getValue, label = "Copy") => {
    const button = el("button", { class: "btn secondary", type: "button" }, label);
    let timer;
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(getValue()).catch(() => null);
      button.textContent = "Copied";
      clearTimeout(timer);
      timer = setTimeout(() => (button.textContent = label), 1500);
    });
    return button;
  };

  const copyField = (label, value) => {
    const id = `field-${label.toLowerCase().replace(/\W+/g, "-")}`;
    return el(
      "div",
      { class: "field" },
      el("label", { for: id }, label),
      el(
        "div",
        { class: "copy-row" },
        el("input", { id, type: "text", readonly: true, value }),
        copyButton(() => value),
      ),
    );
  };

  const statusLine = () => el("p", { class: "status", role: "status" });
  const errorLine = () => el("p", { class: "error", role: "alert", hidden: true });

  const showError = (node, error) => {
    node.textContent = error instanceof Error ? error.message : String(error);
    node.hidden = false;
  };

  const flash = (node, text) => {
    node.textContent = text;
    setTimeout(() => node.textContent === text && (node.textContent = ""), 3000);
  };

  const confirmDialog = ({ title, body, action, danger = false }) =>
    new Promise((resolve) => {
      const dialog = el(
        "dialog",
        { "aria-labelledby": "confirm-title" },
        el("h2", { id: "confirm-title" }, title),
        el("p", { class: "muted" }, body),
        el(
          "form",
          { method: "dialog", class: "actions" },
          el("button", { class: "btn secondary", value: "cancel" }, "Cancel"),
          el("button", { class: `btn ${danger ? "danger" : "primary"}`, value: "confirm" }, action),
        ),
      );
      dialog.addEventListener("close", () => {
        resolve(dialog.returnValue === "confirm");
        dialog.remove();
      });
      document.body.append(dialog);
      dialog.showModal();
    });

  const switchRow = (id, label, hint, input) =>
    el(
      "div",
      { class: "switch-row" },
      el("div", {}, el("label", { for: id }, label), hint && el("p", { class: "hint" }, hint)),
      input,
    );

  const flagToggle = (app, id, bit, errorNode, onSaved) => {
    const toggle = el("input", {
      id,
      type: "checkbox",
      checked: (app.flags & bit) !== 0,
      onchange: async () => {
        errorNode.hidden = true;
        toggle.disabled = true;
        try {
          Object.assign(
            app,
            await api("PATCH", `/applications/${app.id}`, {
              flags: toggle.checked ? app.flags | bit : app.flags & ~bit,
            }),
          );
          onSaved?.();
        } catch (e) {
          toggle.checked = !toggle.checked;
          showError(errorNode, e);
        } finally {
          toggle.disabled = false;
        }
      },
    });
    return toggle;
  };

  const secretBox = (id, label, value, hint) =>
    el(
      "div",
      { class: "field token-box" },
      el("label", { for: id }, label),
      el(
        "div",
        { class: "copy-row" },
        el("input", { id, type: "text", readonly: true, value }),
        copyButton(() => value),
      ),
      el("p", { class: "hint" }, hint),
    );

  const showPendingBotToken = (applicationId) => {
    const current = currentBotToken;
    const token = pendingTokens.get(applicationId);
    if (
      !token ||
      current?.applicationId !== applicationId ||
      current.version !== renderVersion ||
      !current.box.isConnected
    )
      return;
    current.show(token);
    pendingTokens.delete(applicationId);
  };

  const showPendingClientSecret = (applicationId) => {
    const current = currentClientSecret;
    const secret = pendingClientSecrets.get(applicationId);
    if (
      !secret ||
      current?.applicationId !== applicationId ||
      current.version !== renderVersion ||
      !current.slot.isConnected
    )
      return;
    current.show(secret);
    pendingClientSecrets.delete(applicationId);
  };

  const createDialog = () => {
    const input = el("input", {
      id: "new-app-name",
      type: "text",
      maxlength: "32",
      required: true,
      autocomplete: "off",
    });
    const error = errorLine();
    const submit = el("button", { class: "btn primary", type: "submit" }, "Create");
    const dialog = el(
      "dialog",
      { "aria-labelledby": "create-title" },
      el(
        "form",
        {
          onsubmit: async (event) => {
            event.preventDefault();
            error.hidden = true;
            if (!input.value.trim()) {
              input.setAttribute("aria-invalid", "true");
              showError(error, "Give your application a name.");
              input.focus();
              return;
            }
            submit.disabled = true;
            try {
              const app = await api("POST", "/applications", { name: input.value.trim() });
              if (!dialog.isConnected || !dialog.open) return;
              dialog.close();
              navigate(`/developers/applications/${app.id}/information`);
            } catch (e) {
              showError(error, e);
            } finally {
              submit.disabled = false;
            }
          },
        },
        el("h2", { id: "create-title" }, "Create an application"),
        el("p", { class: "muted" }, "An application holds your bot, its token and its commands."),
        el(
          "div",
          { class: "field", style: "margin-top:16px" },
          el("label", { for: "new-app-name" }, "Name"),
          input,
          error,
        ),
        el(
          "div",
          { class: "actions" },
          el(
            "button",
            { class: "btn secondary", type: "button", onclick: () => dialog.close() },
            "Cancel",
          ),
          submit,
        ),
      ),
    );
    input.setAttribute("aria-describedby", "create-error");
    error.id = "create-error";
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  };

  // A profile widget lives on an application, so this makes one named after you with your avatar, like the app header on the card.
  const widgetDialog = async () => {
    const version = renderVersion;
    const request = ++widgetRequestVersion;
    const me = await api("GET", "/users/@me").catch(() => null);
    if (version !== renderVersion || request !== widgetRequestVersion) return;
    const input = el("input", {
      id: "new-widget-name",
      type: "text",
      maxlength: "32",
      required: true,
      autocomplete: "off",
      value: me?.global_name ?? me?.username ?? "",
    });
    const avatar = avatarUrl(me);
    const useAvatar = el("input", {
      id: "new-widget-avatar",
      type: "checkbox",
      checked: !!avatar,
      disabled: !avatar,
    });
    const error = errorLine();
    error.id = "widget-create-error";
    input.setAttribute("aria-describedby", "widget-create-error");
    const submit = el("button", { class: "btn primary", type: "submit" }, "Create");
    const dialog = el(
      "dialog",
      { "aria-labelledby": "widget-create-title" },
      el(
        "form",
        {
          onsubmit: async (event) => {
            event.preventDefault();
            error.hidden = true;
            if (!input.value.trim()) {
              input.setAttribute("aria-invalid", "true");
              showError(error, "Give your widget a name.");
              input.focus();
              return;
            }
            submit.disabled = true;
            try {
              const app = await api("POST", "/applications", { name: input.value.trim() });
              if (useAvatar.checked && avatar) {
                const blob = await fetch(avatar)
                  .then((res) => (res.ok ? res.blob() : null))
                  .catch(() => null);
                if (blob)
                  await api("PATCH", `/applications/${app.id}`, {
                    icon: await readFile(blob),
                  }).catch(() => null);
              }
              if (!dialog.isConnected || !dialog.open) return;
              dialog.close();
              navigate(`/developers/applications/${app.id}/widget`);
            } catch (e) {
              showError(error, e);
            } finally {
              submit.disabled = false;
            }
          },
        },
        el("h2", { id: "widget-create-title" }, "Create a profile widget"),
        el(
          "p",
          { class: "muted" },
          "Your widget's name and icon show at the top of the card, so most people use their own.",
        ),
        el(
          "div",
          { class: "fields", style: "margin-top:16px" },
          el("div", { class: "field" }, el("label", { for: "new-widget-name" }, "Name"), input),
          el("label", { class: "check" }, useAvatar, "Use my avatar as the icon"),
          error,
        ),
        el(
          "div",
          { class: "actions" },
          el(
            "button",
            { class: "btn secondary", type: "button", onclick: () => dialog.close() },
            "Cancel",
          ),
          submit,
        ),
      ),
    );
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  };

  const setNav = (app, section) => {
    const link = (href, label, current) =>
      el("a", { href, "data-link": true, "aria-current": current ? "page" : null }, label);
    nav.replaceChildren(
      ...[
        link("/developers/applications", "Applications", !app),
        app && el("p", { class: "nav-heading", title: app.name }, app.name),
        app &&
          link(
            `/developers/applications/${app.id}/information`,
            "General information",
            section === "information",
          ),
        app &&
          link(
            `/developers/applications/${app.id}/installation`,
            "Installation",
            section === "installation",
          ),
        app && link(`/developers/applications/${app.id}/oauth2`, "OAuth2", section === "oauth2"),
        app && link(`/developers/applications/${app.id}/bot`, "Bot", section === "bot"),
        app && link(`/developers/applications/${app.id}/emojis`, "Emojis", section === "emojis"),
        app &&
          link(
            `/developers/applications/${app.id}/rich-presence`,
            "Rich Presence",
            section === "rich-presence",
          ),
        app &&
          link(`/developers/applications/${app.id}/widget`, "Profile Widget", section === "widget"),
        app &&
          link(`/developers/applications/${app.id}/testers`, "App Testers", section === "testers"),
        app &&
          link(
            `/developers/applications/${app.id}/activities`,
            "Activities",
            section === "activities",
          ),
      ].filter(Boolean),
    );
  };

  const renderList = async () => {
    const version = renderVersion;
    setNav(null);
    document.title = `Applications | ${config.instanceName} Developer Portal`;
    view.replaceChildren(el("p", { class: "loading" }, "Loading applications"));
    const apps = await api("GET", "/applications");
    if (version !== renderVersion) return;
    const head = el(
      "div",
      { class: "page-head" },
      el("h1", {}, "Applications"),
      el(
        "div",
        { class: "actions page-actions" },
        el(
          "button",
          { class: "btn secondary", type: "button", onclick: widgetDialog },
          "New profile widget",
        ),
        el(
          "button",
          { class: "btn primary", type: "button", onclick: createDialog },
          "New application",
        ),
      ),
    );
    const lead = el(
      "p",
      { class: "muted page-lead" },
      "Create an application to get a bot, a token and an invite link for your servers, or to put your own widget on your profile.",
    );
    const body = apps.length
      ? el(
          "div",
          { class: "app-grid" },
          apps
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((app) =>
              el(
                "a",
                {
                  class: "app-card",
                  href: `/developers/applications/${app.id}/information`,
                  "data-link": true,
                },
                appIcon(app),
                el("span", {}, app.name),
              ),
            ),
        )
      : el(
          "div",
          { class: "empty" },
          el("h2", {}, "No applications yet"),
          el(
            "p",
            { class: "muted" },
            "Your applications appear here. Create one to set up a bot, or make a widget for your profile.",
          ),
          el(
            "div",
            { class: "actions empty-actions" },
            el(
              "button",
              { class: "btn secondary", type: "button", onclick: widgetDialog },
              "New profile widget",
            ),
            el(
              "button",
              { class: "btn primary", type: "button", onclick: createDialog },
              "Create an application",
            ),
          ),
        );
    view.replaceChildren(head, lead, body);
  };

  const renderInformation = (app) => {
    const version = renderVersion;
    const name = el("input", { id: "app-name", type: "text", maxlength: "32", value: app.name });
    const description = el(
      "textarea",
      { id: "app-description", maxlength: "400" },
      app.description ?? "",
    );
    const endpoint = el("input", {
      id: "app-endpoint",
      type: "url",
      inputmode: "url",
      placeholder: "https://example.com/interactions",
      value: app.interactions_endpoint_url ?? "",
    });
    const fileInput = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/gif,image/webp",
      hidden: true,
    });
    let icon;
    const preview = el("span", {}, appIcon(app));
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      icon = await readFile(file);
      preview.replaceChildren(el("img", { class: "app-icon", src: icon, alt: "" }));
    });
    const terms = el("input", {
      id: "app-terms",
      type: "url",
      inputmode: "url",
      placeholder: "https://example.com/terms",
      value: app.terms_of_service_url ?? "",
    });
    const privacy = el("input", {
      id: "app-privacy",
      type: "url",
      inputmode: "url",
      placeholder: "https://example.com/privacy",
      value: app.privacy_policy_url ?? "",
    });
    const tags = [...(app.tags ?? [])];
    const tagInput = el("input", {
      id: "app-tags",
      type: "text",
      maxlength: "20",
      placeholder: "Add a tag and press Enter",
      autocomplete: "off",
    });
    const tagList = el("ul", { class: "tag-list", "aria-label": "Tags" });
    const renderTags = () => {
      tagList.replaceChildren(
        ...tags.map((tag) =>
          el(
            "li",
            { class: "tag" },
            el("span", {}, tag),
            el(
              "button",
              {
                type: "button",
                class: "tag-remove",
                "aria-label": `Remove ${tag}`,
                onclick: () => {
                  tags.splice(tags.indexOf(tag), 1);
                  renderTags();
                  tagInput.focus();
                },
              },
              "×",
            ),
          ),
        ),
      );
      tagInput.disabled = tags.length >= 5;
      tagInput.placeholder =
        tags.length >= 5 ? "You can add up to 5 tags" : "Add a tag and press Enter";
    };
    tagInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== ",") return;
      event.preventDefault();
      const value = tagInput.value.trim();
      if (value && !tags.includes(value) && tags.length < 5) tags.push(value);
      tagInput.value = "";
      renderTags();
    });
    renderTags();
    const draftSnapshot = () =>
      JSON.stringify([
        name.value,
        description.value,
        endpoint.value,
        terms.value,
        privacy.value,
        tags,
        tagInput.value,
        icon,
        fileInput.value,
      ]);
    const status = statusLine();
    const error = errorLine();
    const save = el("button", { class: "btn primary", type: "submit" }, "Save changes");
    const form = el(
      "form",
      {
        class: "card",
        onsubmit: async (event) => {
          event.preventDefault();
          error.hidden = true;
          name.removeAttribute("aria-invalid");
          endpoint.removeAttribute("aria-invalid");
          terms.removeAttribute("aria-invalid");
          privacy.removeAttribute("aria-invalid");
          if (!name.value.trim()) {
            name.setAttribute("aria-invalid", "true");
            showError(error, "Give your application a name.");
            name.focus();
            return;
          }
          save.disabled = true;
          const submittedDraft = draftSnapshot();
          const submittedIcon = icon;
          try {
            const updated = await api("PATCH", `/applications/${app.id}`, {
              name: name.value.trim(),
              description: description.value,
              interactions_endpoint_url: endpoint.value.trim() || null,
              terms_of_service_url: terms.value.trim() || null,
              privacy_policy_url: privacy.value.trim() || null,
              tags: [
                ...tags,
                ...(tagInput.value.trim() && tags.length < 5 ? [tagInput.value.trim()] : []),
              ],
              ...(submittedIcon && { icon: submittedIcon }),
            });
            if (version !== renderVersion || !form.isConnected) return;
            const hasNewerEdits = submittedDraft !== draftSnapshot();
            if (!hasNewerEdits) {
              tags.splice(0, tags.length, ...(updated.tags ?? []));
              tagInput.value = "";
              renderTags();
            }
            Object.assign(app, updated);
            if (icon === submittedIcon) icon = undefined;
            setNav(app, "information");
            flash(
              status,
              hasNewerEdits ? "Changes saved. You have unsaved changes." : "Changes saved.",
            );
          } catch (e) {
            if (version !== renderVersion || !form.isConnected) return;
            const field = /endpoint/i.test(e.message)
              ? endpoint
              : /terms/i.test(e.field ?? "")
                ? terms
                : /privacy/i.test(e.field ?? "")
                  ? privacy
                  : null;
            if (field) {
              field.setAttribute("aria-invalid", "true");
              field.focus();
            }
            showError(error, e);
          } finally {
            save.disabled = false;
          }
        },
      },
      el("h2", {}, "General information"),
      el(
        "p",
        { class: "muted" },
        "What people see when they add your application or meet its bot.",
      ),
      el(
        "div",
        { class: "fields" },
        el(
          "div",
          { class: "media-row" },
          preview,
          el(
            "div",
            { class: "field" },
            el("span", { class: "label" }, "App icon"),
            el(
              "button",
              { class: "btn secondary", type: "button", onclick: () => fileInput.click() },
              "Upload image",
            ),
            fileInput,
          ),
        ),
        el("div", { class: "field" }, el("label", { for: "app-name" }, "Name"), name),
        el(
          "div",
          { class: "field" },
          el("label", { for: "app-description" }, "Description"),
          description,
          el("p", { class: "hint" }, "Shown on the app's profile, up to 400 characters."),
        ),
        el(
          "div",
          { class: "field" },
          el("label", { for: "app-endpoint" }, "Interactions endpoint URL"),
          endpoint,
          el(
            "p",
            { class: "hint" },
            "Optional. Interactions are sent to this URL as HTTP POST requests instead of over the gateway. The URL has to answer a ping before it is saved.",
          ),
        ),
        el(
          "div",
          { class: "field" },
          el("label", { for: "app-tags" }, "Tags"),
          tagList,
          tagInput,
          el(
            "p",
            { class: "hint" },
            "Up to 5 tags, 20 characters each. They help people find your app.",
          ),
        ),
        el(
          "div",
          { class: "field-row" },
          el(
            "div",
            { class: "field" },
            el("label", { for: "app-terms" }, "Terms of Service URL"),
            terms,
          ),
          el(
            "div",
            { class: "field" },
            el("label", { for: "app-privacy" }, "Privacy Policy URL"),
            privacy,
          ),
        ),
        el(
          "div",
          { class: "field-row" },
          copyField("Application ID", app.id),
          copyField("Public key", app.verify_key ?? ""),
        ),
      ),
      el("div", { class: "actions" }, save, status),
      error,
    );
    const remove = el(
      "button",
      {
        class: "btn danger",
        type: "button",
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Delete ${app.name}?`,
            body: "This deletes the application, its bot and its commands, and removes the bot from every server. You can't undo this.",
            action: "Delete application",
            danger: true,
          });
          if (!ok || version !== renderVersion || !remove.isConnected || remove.disabled) return;
          remove.disabled = true;
          try {
            await api("POST", `/applications/${app.id}/delete`, {});
            if (version !== renderVersion || !remove.isConnected) return;
            navigate("/developers/applications");
          } catch (e) {
            if (version !== renderVersion || !remove.isConnected) return;
            showError(deleteError, e);
          } finally {
            remove.disabled = false;
          }
        },
      },
      "Delete application",
    );
    const deleteError = errorLine();
    const danger = el(
      "section",
      { class: "card" },
      el("h2", {}, "Delete application"),
      el("p", { class: "muted" }, "Deleting an application also deletes its bot user."),
      remove,
      deleteError,
    );
    const discoveryError = errorLine();
    const discoveryToggle = el("input", {
      id: "app-discoverable",
      type: "checkbox",
      checked: app.is_discoverable === true,
      onchange: async () => {
        discoveryError.hidden = true;
        discoveryToggle.disabled = true;
        try {
          Object.assign(
            app,
            await api("PATCH", `/applications/${app.id}`, {
              discoverability_state: discoveryToggle.checked ? 3 : 2,
            }),
          );
        } catch (e) {
          discoveryToggle.checked = !discoveryToggle.checked;
          showError(discoveryError, e);
        } finally {
          discoveryToggle.disabled = false;
        }
      },
    });
    const discovery = el(
      "section",
      { class: "card" },
      el("h2", {}, "App Directory"),
      el(
        "p",
        { class: "muted" },
        "Listed apps show up in the App Directory and the app launcher for everyone on this instance.",
      ),
      el(
        "div",
        { class: "fields" },
        switchRow(
          "app-discoverable",
          "List this app in the App Directory",
          'Only public bots are listed, so "Let anyone add this bot" on the Bot page has to be on.',
          discoveryToggle,
        ),
      ),
      discoveryError,
    );
    return [form, discovery, danger];
  };

  const renderBot = (app) => {
    const version = renderVersion;
    const tokenError = errorLine();
    const tokenBox = el("div", { class: "token-box", hidden: true });
    const showToken = (value) => {
      tokenBox.replaceChildren(
        el(
          "div",
          { class: "field" },
          el("label", { for: "bot-token" }, "Token"),
          el(
            "div",
            { class: "copy-row" },
            el("input", { id: "bot-token", type: "text", readonly: true, value }),
            copyButton(() => value),
          ),
          el(
            "p",
            { class: "hint" },
            "Copy it now. For your security the token is shown only once, and resetting it again signs out every running copy of the bot.",
          ),
        ),
      );
      tokenBox.hidden = false;
    };

    if (!app.bot) {
      const add = el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onclick: async () => {
            add.disabled = true;
            try {
              const token = (await api("POST", `/applications/${app.id}/bot`))?.token;
              if (typeof token === "string" && token) pendingTokens.set(app.id, token);
              if (version !== renderVersion || !add.isConnected) return;
              await render();
            } catch (e) {
              if (version !== renderVersion || !add.isConnected) return;
              showError(tokenError, e);
            } finally {
              add.disabled = false;
            }
          },
        },
        "Add bot",
      );
      return [
        el(
          "section",
          { class: "card" },
          el("h2", {}, "Bot"),
          el(
            "p",
            { class: "muted" },
            "Give this application a bot user so it can join servers, read events and answer commands.",
          ),
          add,
          tokenError,
        ),
      ];
    }

    const username = el("input", {
      id: "bot-username",
      type: "text",
      maxlength: "32",
      value: app.bot.username,
    });
    const fileInput = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/gif,image/webp",
      hidden: true,
    });
    const avatarSrc = avatarUrl(app.bot);
    const preview = el(
      "span",
      {},
      avatarSrc
        ? el("img", { class: "app-icon small round", src: avatarSrc, alt: "" })
        : appIcon({ name: app.bot.username }, "small round"),
    );
    let avatar;
    let avatarReadVersion = 0;
    let savedUsername = username.value;
    const status = statusLine();
    const error = errorLine();
    const syncProfileStatus = () => {
      status.textContent =
        username.value !== savedUsername || avatar !== undefined ? "You have unsaved changes." : "";
    };
    username.addEventListener("input", syncProfileStatus);
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const readVersion = ++avatarReadVersion;
      try {
        const value = await readFile(file);
        if (readVersion !== avatarReadVersion || version !== renderVersion || !profile.isConnected)
          return;
        avatar = value;
        preview.replaceChildren(el("img", { class: "app-icon small round", src: avatar, alt: "" }));
        syncProfileStatus();
      } catch (e) {
        if (readVersion !== avatarReadVersion || version !== renderVersion || !profile.isConnected)
          return;
        showError(error, e);
      }
    });
    const save = el("button", { class: "btn primary", type: "submit" }, "Save changes");
    const profile = el(
      "form",
      {
        class: "card",
        onsubmit: async (event) => {
          event.preventDefault();
          if (version !== renderVersion || !profile.isConnected || save.disabled) return;
          error.hidden = true;
          username.removeAttribute("aria-invalid");
          if (!username.value.trim()) {
            username.setAttribute("aria-invalid", "true");
            showError(error, "Give your bot a username.");
            username.focus();
            return;
          }
          const submittedUsername = username.value;
          const submittedAvatar = avatar;
          save.disabled = true;
          try {
            const bot = await api("PATCH", `/applications/${app.id}/bot`, {
              username: submittedUsername.trim(),
              ...(submittedAvatar && { avatar: submittedAvatar }),
            });
            if (version !== renderVersion || !profile.isConnected) return;
            app.bot = bot;
            savedUsername = submittedUsername;
            if (avatar === submittedAvatar) avatar = undefined;
            if (username.value === submittedUsername && avatar === undefined)
              flash(status, "Changes saved.");
            else syncProfileStatus();
          } catch (e) {
            if (version !== renderVersion || !profile.isConnected) return;
            if (username.value === submittedUsername) username.setAttribute("aria-invalid", "true");
            showError(error, e);
          } finally {
            save.disabled = false;
          }
        },
      },
      el("h2", {}, "Bot"),
      el("p", { class: "muted" }, "Your bot's profile in servers and direct messages."),
      el(
        "div",
        { class: "fields" },
        el(
          "div",
          { class: "media-row" },
          preview,
          el(
            "div",
            { class: "field" },
            el("span", { class: "label" }, "Avatar"),
            el(
              "button",
              { class: "btn secondary", type: "button", onclick: () => fileInput.click() },
              "Upload image",
            ),
            fileInput,
          ),
        ),
        el("div", { class: "field" }, el("label", { for: "bot-username" }, "Username"), username),
      ),
      el("div", { class: "actions" }, save, status),
      error,
    );

    const reset = el(
      "button",
      {
        class: "btn primary",
        type: "button",
        onclick: async () => {
          if (pendingBotTokenResets.has(app.id) || version !== renderVersion || !reset.isConnected)
            return;
          pendingBotTokenResets.add(app.id);
          reset.disabled = true;
          try {
            const ok = await confirmDialog({
              title: "Reset the bot's token?",
              body: "Your bot stops working until you give it the new token.",
              action: "Reset token",
            });
            if (!ok || version !== renderVersion || !reset.isConnected) return;
            tokenError.hidden = true;
            pendingTokens.delete(app.id);
            const token = (await api("POST", `/applications/${app.id}/bot/reset`, {})).token;
            if (typeof token === "string" && token) pendingTokens.set(app.id, token);
          } catch (e) {
            if (version !== renderVersion || !tokenBox.isConnected) return;
            showError(tokenError, e);
          } finally {
            pendingBotTokenResets.delete(app.id);
            showPendingBotToken(app.id);
            reset.disabled = false;
            const current = currentBotToken;
            if (
              current?.applicationId === app.id &&
              current.version === renderVersion &&
              current.button.isConnected
            )
              current.button.disabled = false;
          }
        },
      },
      "Reset token",
    );
    reset.disabled = pendingBotTokenResets.has(app.id);
    currentBotToken = {
      applicationId: app.id,
      version,
      button: reset,
      box: tokenBox,
      show: showToken,
    };
    requestAnimationFrame(() => showPendingBotToken(app.id));
    const tokenCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Token"),
      el(
        "p",
        { class: "muted" },
        "Your bot signs in with its token. Keep it secret, anyone who has it controls your bot.",
      ),
      reset,
      tokenBox,
      tokenError,
    );

    const publicError = errorLine();
    const publicToggle = el("input", {
      id: "bot-public",
      type: "checkbox",
      checked: app.bot_public !== false,
      onchange: async () => {
        publicError.hidden = true;
        try {
          Object.assign(
            app,
            await api("PATCH", `/applications/${app.id}`, { bot_public: publicToggle.checked }),
          );
        } catch (e) {
          publicToggle.checked = !publicToggle.checked;
          showError(publicError, e);
        }
      },
    });
    const codeGrantToggle = el("input", {
      id: "bot-code-grant",
      type: "checkbox",
      checked: app.bot_require_code_grant === true,
      onchange: async () => {
        publicError.hidden = true;
        try {
          Object.assign(
            app,
            await api("PATCH", `/applications/${app.id}`, {
              bot_require_code_grant: codeGrantToggle.checked,
            }),
          );
        } catch (e) {
          codeGrantToggle.checked = !codeGrantToggle.checked;
          showError(publicError, e);
        }
      },
    });
    const publicCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Authorization flow"),
      el("p", { class: "muted" }, "Who can add the bot, and how."),
      el(
        "div",
        { class: "fields" },
        switchRow(
          "bot-public",
          "Let anyone add this bot",
          "When this is off, only you can add the bot to servers.",
          publicToggle,
        ),
        switchRow(
          "bot-code-grant",
          "Require the OAuth2 code grant",
          "People can add the bot only through a link that sends them back to one of your redirect URLs with an authorization code.",
          codeGrantToggle,
        ),
      ),
      publicError,
    );
    const intentsError = errorLine();
    const intentsCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Privileged gateway intents"),
      el(
        "p",
        { class: "muted" },
        "Some gateway intents are privileged. Turn on the ones your bot asks for when it connects.",
      ),
      el(
        "div",
        { class: "fields" },
        INTENTS.map(([key, label, description, bit]) => {
          const toggle = el("input", {
            id: `intent-${key}`,
            type: "checkbox",
            checked: (app.flags & (bit | (bit >> 1))) !== 0,
            onchange: async () => {
              intentsError.hidden = true;
              const flags = toggle.checked ? app.flags | bit : app.flags & ~(bit | (bit >> 1));
              try {
                Object.assign(app, await api("PATCH", `/applications/${app.id}`, { flags }));
              } catch (e) {
                toggle.checked = !toggle.checked;
                showError(intentsError, e);
              }
            },
          });
          return el(
            "div",
            { class: "switch-row" },
            el(
              "div",
              {},
              el("label", { for: `intent-${key}` }, label),
              el("p", { class: "hint" }, description),
            ),
            toggle,
          );
        }),
      ),
      intentsError,
    );
    return [profile, tokenCard, publicCard, intentsCard];
  };

  const permissionPicker = (initial = 0n) => {
    const boxes = [];
    const groups = PERMISSIONS.map(([title, items]) =>
      el(
        "div",
        { class: "check-group" },
        el("h3", {}, title),
        el(
          "div",
          { class: "check-grid" },
          items.map(([label, bit]) => {
            const box = el("input", {
              type: "checkbox",
              "data-bit": bit,
              checked: (initial & (1n << BigInt(bit))) !== 0n,
            });
            boxes.push(box);
            return el("label", { class: "check" }, box, label);
          }),
        ),
      ),
    );
    return {
      groups,
      boxes,
      value: () =>
        boxes
          .filter((box) => box.checked)
          .reduce((sum, box) => sum | (1n << BigInt(box.dataset.bit)), 0n),
    };
  };

  const renderInstallation = (app) => {
    const config = app.integration_types_config ?? {};
    const status = statusLine();
    const error = errorLine();
    const contexts = {
      1: el("input", { id: "context-user", type: "checkbox", checked: "1" in config }),
      0: el("input", { id: "context-guild", type: "checkbox", checked: "0" in config }),
    };
    const contextsCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Installation contexts"),
      el("p", { class: "muted" }, "Choose where people can install your app."),
      el(
        "div",
        { class: "fields" },
        el(
          "div",
          { class: "switch-row" },
          el(
            "div",
            {},
            el("label", { for: "context-user" }, "User install"),
            el(
              "p",
              { class: "hint" },
              "People install the app on their account and use its commands anywhere.",
            ),
          ),
          contexts[1],
        ),
        el(
          "div",
          { class: "switch-row" },
          el(
            "div",
            {},
            el("label", { for: "context-guild" }, "Guild install"),
            el("p", { class: "hint" }, "People who can manage a server add the app to it."),
          ),
          contexts[0],
        ),
      ),
    );

    const initialType = app.custom_install_url
      ? "custom"
      : Object.values(config).some((entry) => entry?.oauth2_install_params)
        ? "discord"
        : "none";
    const radios = Object.fromEntries(
      ["discord", "custom", "none"].map((type) => [
        type,
        el("input", {
          type: "radio",
          name: "install-link",
          id: `install-link-${type}`,
          value: type,
          checked: type === initialType,
        }),
      ]),
    );
    const providedLink = `${location.origin}/oauth2/authorize?client_id=${app.id}`;
    const customUrl = el("input", {
      id: "install-url",
      type: "url",
      inputmode: "url",
      placeholder: "https://example.com/install",
      value: app.custom_install_url ?? "",
    });
    const providedField = el(
      "div",
      { class: "field" },
      el("label", { for: "install-provided" }, "Install link"),
      el(
        "div",
        { class: "copy-row" },
        el("input", { id: "install-provided", type: "text", readonly: true, value: providedLink }),
        copyButton(() => providedLink),
      ),
    );
    const customField = el(
      "div",
      { class: "field" },
      el("label", { for: "install-url" }, "Custom URL"),
      customUrl,
    );
    const linkCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Install link"),
      el("p", { class: "muted" }, "The link behind the Add App button on your app's profile."),
      el(
        "div",
        { class: "fields" },
        el(
          "div",
          { class: "radio-list", role: "radiogroup", "aria-label": "Install link" },
          el("label", { class: "check" }, radios.discord, "Provided link"),
          el("label", { class: "check" }, radios.custom, "Custom URL"),
          el("label", { class: "check" }, radios.none, "None"),
        ),
        providedField,
        customField,
      ),
    );

    const guildParams = config["0"]?.oauth2_install_params ?? {
      scopes: ["applications.commands", "bot"],
      permissions: "0",
    };
    const guildScopes = {
      "applications.commands": el("input", {
        type: "checkbox",
        checked: guildParams.scopes.includes("applications.commands"),
      }),
      bot: el("input", { type: "checkbox", checked: guildParams.scopes.includes("bot") }),
    };
    const picker = permissionPicker(BigInt(guildParams.permissions || "0"));
    const permissionsGroup = el(
      "div",
      { class: "check-group" },
      el("h3", {}, "Guild install permissions"),
      picker.groups,
    );
    const userSettings = el(
      "div",
      { class: "check-group" },
      el("h3", {}, "User install scopes"),
      el(
        "label",
        { class: "check" },
        el("input", { type: "checkbox", checked: true, disabled: true }),
        "applications.commands",
      ),
    );
    const guildSettings = el(
      "div",
      { class: "check-group" },
      el("h3", {}, "Guild install scopes"),
      el(
        "div",
        { class: "check-grid" },
        Object.entries(guildScopes).map(([scope, box]) =>
          el("label", { class: "check" }, box, scope),
        ),
      ),
    );
    const settingsCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Default install settings"),
      el("p", { class: "muted" }, "The scopes and permissions the provided link asks for."),
      userSettings,
      guildSettings,
      permissionsGroup,
    );

    const linkType = () => Object.values(radios).find((radio) => radio.checked)?.value;
    const update = () => {
      providedField.hidden = linkType() !== "discord";
      customField.hidden = linkType() !== "custom";
      settingsCard.hidden = linkType() !== "discord";
      userSettings.hidden = !contexts[1].checked;
      guildSettings.hidden = !contexts[0].checked;
      permissionsGroup.hidden = !contexts[0].checked || !guildScopes.bot.checked;
    };
    [...Object.values(contexts), ...Object.values(radios), ...Object.values(guildScopes)].forEach(
      (input) => input.addEventListener("change", update),
    );
    update();

    const save = el("button", { class: "btn primary", type: "submit" }, "Save changes");
    const form = el(
      "form",
      {
        onsubmit: async (event) => {
          event.preventDefault();
          error.hidden = true;
          customUrl.removeAttribute("aria-invalid");
          const type = linkType();
          if (!contexts[0].checked && !contexts[1].checked)
            return showError(error, "Pick at least one installation context.");
          if (type === "custom" && !customUrl.value.trim()) {
            customUrl.setAttribute("aria-invalid", "true");
            showError(error, "Enter the URL people should open to install your app.");
            customUrl.focus();
            return;
          }
          const scopes = Object.entries(guildScopes)
            .filter(([, box]) => box.checked)
            .map(([scope]) => scope);
          if (type === "discord" && contexts[0].checked && !scopes.length)
            return showError(error, "Pick at least one scope for guild installs.");
          const integration_types_config = {
            ...(contexts[0].checked && {
              0:
                type === "discord"
                  ? {
                      oauth2_install_params: {
                        scopes,
                        permissions: scopes.includes("bot") ? picker.value().toString() : "0",
                      },
                    }
                  : {},
            }),
            ...(contexts[1].checked && {
              1:
                type === "discord"
                  ? {
                      oauth2_install_params: {
                        scopes: ["applications.commands"],
                        permissions: "0",
                      },
                    }
                  : {},
            }),
          };
          save.disabled = true;
          try {
            Object.assign(
              app,
              await api("PATCH", `/applications/${app.id}`, {
                integration_types_config,
                custom_install_url: type === "custom" ? customUrl.value.trim() : null,
              }),
            );
            flash(status, "Changes saved.");
          } catch (e) {
            if (/url/i.test(e.message)) customUrl.setAttribute("aria-invalid", "true");
            showError(error, e);
          } finally {
            save.disabled = false;
          }
        },
      },
      contextsCard,
      linkCard,
      settingsCard,
      el("div", { class: "actions" }, save, status),
      error,
    );
    return [form];
  };

  const renderEmojis = async (app) => {
    const { items } = await api("GET", `/applications/${app.id}/emojis`);
    const error = errorLine();
    const status = statusLine();
    const fileInput = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/gif,image/webp",
      hidden: true,
    });
    const emojiUrl = (emoji) =>
      `${config.cdn}/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=96`;
    const list = el("div", { class: "emoji-grid" });
    const renderItems = () =>
      list.replaceChildren(
        ...(items.length
          ? items.map((emoji) =>
              el(
                "div",
                { class: "emoji-item" },
                el("img", { src: emojiUrl(emoji), alt: `:${emoji.name}:` }),
                el("span", { title: emoji.name }, emoji.name),
                el(
                  "button",
                  {
                    class: "btn secondary",
                    type: "button",
                    "aria-label": `Delete ${emoji.name}`,
                    onclick: async () => {
                      const ok = await confirmDialog({
                        title: `Delete :${emoji.name}:?`,
                        body: "Messages that use this emoji show its name instead.",
                        action: "Delete emoji",
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await api("DELETE", `/applications/${app.id}/emojis/${emoji.id}`);
                        items.splice(items.indexOf(emoji), 1);
                        renderItems();
                      } catch (e) {
                        showError(error, e);
                      }
                    },
                  },
                  "Delete",
                ),
              ),
            )
          : [
              el(
                "p",
                { class: "muted" },
                "Your app has no emojis yet. Upload one and your bot can use it in any server or DM.",
              ),
            ]),
      );
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      error.hidden = true;
      const name = file.name
        .replace(/\.[^.]+$/, "")
        .replace(/\W/g, "_")
        .slice(0, 32)
        .padEnd(2, "_");
      try {
        items.push(
          await api("POST", `/applications/${app.id}/emojis`, {
            name,
            image: await readFile(file),
          }),
        );
        renderItems();
        flash(status, `Uploaded :${name}:.`);
      } catch (e) {
        showError(error, e);
      }
    });
    renderItems();
    return [
      el(
        "section",
        { class: "card" },
        el("h2", {}, "Emojis"),
        el(
          "p",
          { class: "muted" },
          "Emojis your app owns. Its bot can use them anywhere, without being in the server they came from.",
        ),
        el(
          "div",
          { class: "actions" },
          el(
            "button",
            { class: "btn primary", type: "button", onclick: () => fileInput.click() },
            "Upload emoji",
          ),
          fileInput,
          status,
        ),
        error,
        list,
      ),
    ];
  };

  const renderOAuth = (app) => {
    const version = renderVersion;
    const secretError = errorLine();
    const secretSlot = el("div");
    const resetSecret = el(
      "button",
      {
        class: "btn secondary",
        type: "button",
        onclick: async () => {
          if (
            pendingClientSecretResets.has(app.id) ||
            version !== renderVersion ||
            !resetSecret.isConnected
          )
            return;
          pendingClientSecretResets.add(app.id);
          resetSecret.disabled = true;
          try {
            const ok = await confirmDialog({
              title: "Reset the client secret?",
              body: "Anything that uses the current secret stops working until you give it the new one.",
              action: "Reset secret",
            });
            if (!ok || version !== renderVersion || !resetSecret.isConnected) return;
            secretError.hidden = true;
            pendingClientSecrets.delete(app.id);
            const { secret } = await api("POST", `/applications/${app.id}/reset`, {});
            if (typeof secret === "string" && secret) pendingClientSecrets.set(app.id, secret);
          } catch (e) {
            if (version !== renderVersion || !secretSlot.isConnected) return;
            showError(secretError, e);
          } finally {
            pendingClientSecretResets.delete(app.id);
            showPendingClientSecret(app.id);
            resetSecret.disabled = false;
            const current = currentClientSecret;
            if (
              current?.applicationId === app.id &&
              current.version === renderVersion &&
              current.button.isConnected
            )
              current.button.disabled = false;
          }
        },
      },
      "Reset secret",
    );
    resetSecret.disabled = pendingClientSecretResets.has(app.id);
    currentClientSecret = {
      applicationId: app.id,
      version,
      button: resetSecret,
      slot: secretSlot,
      show: (secret) =>
        secretSlot.replaceChildren(
          secretBox(
            "client-secret",
            "New client secret",
            secret,
            "Copy it now. For your security the secret is shown only once.",
          ),
        ),
    };
    requestAnimationFrame(() => showPendingClientSecret(app.id));
    const publicError = errorLine();
    const clientCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Client information"),
      el(
        "p",
        { class: "muted" },
        "Your app signs people in with these credentials. Keep the secret on your server.",
      ),
      el(
        "div",
        { class: "fields" },
        el(
          "div",
          { class: "field-row" },
          copyField("Client ID", app.id),
          el(
            "div",
            { class: "field" },
            el("span", { class: "label" }, "Client secret"),
            el("div", {}, resetSecret),
          ),
        ),
        secretSlot,
        switchRow(
          "oauth-public-client",
          "Public client",
          "For apps that can't keep a secret, like mobile and desktop apps. They exchange codes with PKCE instead of the client secret.",
          flagToggle(app, "oauth-public-client", FLAGS.publicClient, publicError),
        ),
      ),
      secretError,
      publicError,
    );

    const redirects = [...(app.redirect_uris ?? [])];
    const redirectDraft = () => JSON.stringify(redirects);
    const redirectList = el("div", { class: "fields" });
    const redirectStatus = statusLine();
    const redirectError = errorLine();
    const redirectSelect = el("select", { id: "oauth-redirect" });
    const renderRedirectSelect = () => {
      const current = redirectSelect.value;
      redirectSelect.replaceChildren(
        el("option", { value: "" }, "No redirect"),
        ...(app.redirect_uris ?? []).map((uri) => el("option", { value: uri }, uri)),
      );
      redirectSelect.value = (app.redirect_uris ?? []).includes(current) ? current : "";
    };
    const renderRedirects = () => {
      redirectList.replaceChildren(
        ...redirects.map((uri, index) => {
          const input = el("input", {
            id: `redirect-${index}`,
            type: "url",
            inputmode: "url",
            placeholder: "https://example.com/callback",
            value: uri,
            "aria-label": `Redirect ${index + 1}`,
            oninput: () => (redirects[index] = input.value),
          });
          return el(
            "div",
            { class: "copy-row" },
            input,
            el(
              "button",
              {
                class: "btn secondary",
                type: "button",
                "aria-label": `Remove redirect ${index + 1}`,
                onclick: () => {
                  redirects.splice(index, 1);
                  renderRedirects();
                },
              },
              "Remove",
            ),
          );
        }),
        ...(redirects.length
          ? []
          : [
              el(
                "p",
                { class: "muted" },
                "No redirects yet. Add one to use the authorization code or implicit grant.",
              ),
            ]),
      );
    };
    renderRedirects();
    const saveRedirects = el("button", { class: "btn primary", type: "submit" }, "Save changes");
    const redirectsCard = el(
      "form",
      {
        class: "card",
        onsubmit: async (event) => {
          event.preventDefault();
          if (version !== renderVersion || !redirectsCard.isConnected || saveRedirects.disabled)
            return;
          redirectError.hidden = true;
          redirectList
            .querySelectorAll("input")
            .forEach((input) => input.removeAttribute("aria-invalid"));
          const cleaned = redirects.map((uri) => uri.trim());
          const blank = cleaned.findIndex((uri) => !uri);
          if (blank !== -1) {
            const input = redirectList.querySelectorAll("input")[blank];
            input.setAttribute("aria-invalid", "true");
            input.focus();
            return showError(redirectError, "Enter a URL or remove the empty redirect.");
          }
          const submittedDraft = redirectDraft();
          saveRedirects.disabled = true;
          try {
            const result = await api("PATCH", `/applications/${app.id}`, {
              redirect_uris: cleaned,
            });
            if (version !== renderVersion || !redirectsCard.isConnected) return;
            Object.assign(app, result);
            const unchanged = redirectDraft() === submittedDraft;
            if (unchanged) {
              redirects.splice(0, redirects.length, ...app.redirect_uris);
              renderRedirects();
            }
            renderRedirectSelect();
            update();
            flash(
              redirectStatus,
              unchanged ? "Changes saved." : "Changes saved. You have unsaved changes.",
            );
          } catch (e) {
            if (version !== renderVersion || !redirectsCard.isConnected) return;
            const index = Number(/redirect_uris\.(\d+)/.exec(e.field ?? "")?.[1]);
            const input =
              redirectDraft() !== submittedDraft || Number.isNaN(index)
                ? null
                : redirectList.querySelectorAll("input")[index];
            input?.setAttribute("aria-invalid", "true");
            input?.focus();
            showError(redirectError, e);
          } finally {
            saveRedirects.disabled = false;
          }
        },
      },
      el("h2", {}, "Redirects"),
      el(
        "p",
        { class: "muted" },
        "After someone authorizes your app, they are sent back to one of these URLs. You can add up to 10.",
      ),
      redirectList,
      el(
        "div",
        { class: "actions" },
        el(
          "button",
          {
            class: "btn secondary",
            type: "button",
            onclick: () => {
              if (redirects.length >= 10)
                return showError(redirectError, "You can add up to 10 redirects.");
              redirects.push("");
              renderRedirects();
              redirectList.querySelectorAll("input")[redirects.length - 1]?.focus();
            },
          },
          "Add redirect",
        ),
        saveRedirects,
        redirectStatus,
      ),
      redirectError,
    );

    const scopes = Object.fromEntries(
      SCOPES.map((scope) => [
        scope,
        el("input", {
          type: "checkbox",
          checked: scope === "bot" || scope === "applications.commands",
        }),
      ]),
    );
    const { groups, boxes: permissionBoxes, value: permissionValue } = permissionPicker();
    const permissionsCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Bot permissions"),
      el(
        "p",
        { class: "muted" },
        "The bot gets a role with these permissions in each server it joins.",
      ),
      groups,
    );
    const contexts = app.integration_types_config ?? { 0: {} };
    const installTypes = Object.fromEntries(
      ["0", "1"].map((type) => [
        type,
        el("input", {
          type: "radio",
          name: "oauth-integration",
          id: `oauth-integration-${type}`,
          value: type,
          checked: type === ("0" in contexts ? "0" : "1"),
          disabled: !(type in contexts),
        }),
      ]),
    );
    const installRow = el(
      "div",
      { class: "field" },
      el("span", { class: "label" }, "Integration type"),
      el(
        "div",
        { class: "radio-list", role: "radiogroup", "aria-label": "Integration type" },
        el("label", { class: "check" }, installTypes[0], "Guild install"),
        el("label", { class: "check" }, installTypes[1], "User install"),
      ),
    );
    const redirectHint = el("p", { class: "hint" });
    const redirectRow = el(
      "div",
      { class: "field" },
      el("label", { for: "oauth-redirect" }, "Redirect"),
      redirectSelect,
      redirectHint,
    );
    renderRedirectSelect();
    const output = el("input", { id: "oauth-url", type: "text", readonly: true });
    const open = el("a", { class: "btn primary", target: "_blank", rel: "noopener" }, "Open link");
    const permissionsValue = el("input", { id: "oauth-permissions", type: "text", readonly: true });
    const permissionsField = el(
      "div",
      { class: "field" },
      el("label", { for: "oauth-permissions" }, "Permissions integer"),
      el(
        "div",
        { class: "copy-row" },
        permissionsValue,
        copyButton(() => permissionsValue.value),
      ),
    );
    const update = () => {
      const chosen = Object.entries(scopes)
        .filter(([, box]) => box.checked)
        .map(([scope]) => scope);
      const needsRedirect =
        chosen.some((scope) => scope !== "bot" && scope !== "applications.commands") ||
        (scopes.bot.checked && app.bot_require_code_grant);
      const bits = permissionValue();
      permissionsCard.hidden = !scopes.bot.checked;
      permissionsField.hidden = !scopes.bot.checked;
      installRow.hidden =
        scopes.bot.checked || !scopes["applications.commands"].checked || chosen.length !== 1;
      redirectHint.textContent = !app.redirect_uris?.length
        ? "Add a redirect above to use scopes that need one."
        : needsRedirect
          ? "These scopes send people back to your app with a code, so pick where to send them."
          : "Optional. Pick one to send people back to your app after they authorize it.";
      const params = new URLSearchParams({ client_id: app.id });
      if (scopes.bot.checked) params.set("permissions", bits.toString());
      if (!installRow.hidden) params.set("integration_type", installTypes[1].checked ? "1" : "0");
      else if (scopes.bot.checked) params.set("integration_type", "0");
      if (redirectSelect.value) {
        params.set("response_type", "code");
        params.set("redirect_uri", redirectSelect.value);
      }
      params.set("scope", chosen.join(" "));
      const missingRedirect = needsRedirect && !redirectSelect.value;
      if (missingRedirect && chosen.length) redirectSelect.setAttribute("aria-invalid", "true");
      else redirectSelect.removeAttribute("aria-invalid");
      const url = `${location.origin}/oauth2/authorize?${params}`;
      const ready = chosen.length > 0 && !missingRedirect;
      output.value = ready ? url : "";
      output.placeholder = !chosen.length
        ? "Pick at least one scope."
        : "Pick a redirect to finish the link.";
      permissionsValue.value = bits.toString();
      open.href = url;
      open.hidden = !ready;
    };
    [
      ...Object.values(scopes),
      ...permissionBoxes,
      ...Object.values(installTypes),
      redirectSelect,
    ].forEach((box) => box.addEventListener("change", update));
    const scopesCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "OAuth2 URL generator"),
      el(
        "p",
        { class: "muted" },
        "Pick the scopes your app needs. Use the link to add your bot to a server or to sign people in.",
      ),
      el(
        "div",
        { class: "check-grid" },
        Object.entries(scopes).map(([scope, box]) => el("label", { class: "check" }, box, scope)),
      ),
    );
    const outputCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Generated URL"),
      el(
        "div",
        { class: "fields" },
        installRow,
        redirectRow,
        el(
          "div",
          { class: "field" },
          el("label", { for: "oauth-url" }, "Generated URL"),
          el(
            "div",
            { class: "copy-row" },
            output,
            copyButton(() => output.value),
          ),
        ),
        permissionsField,
      ),
      el("div", { class: "actions" }, open),
    );
    update();
    return [clientCard, redirectsCard, scopesCard, permissionsCard, outputCard];
  };

  const renderRichPresence = async (app) => {
    const assets = await api("GET", `/oauth2/applications/${app.id}/assets`);
    const coverError = errorLine();
    const coverStatus = statusLine();
    const coverInput = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/gif,image/webp",
      hidden: true,
    });
    const coverPreview = el("div", { class: "cover-preview" });
    const renderCover = () =>
      coverPreview.replaceChildren(
        app.cover_image
          ? el("img", {
              src: `${config.cdn}/app-icons/${app.id}/${app.cover_image}.png?size=1024`,
              alt: "Current Rich Presence invite image",
            })
          : el("span", { class: "muted" }, "No image yet"),
      );
    renderCover();
    coverInput.addEventListener("change", async () => {
      const file = coverInput.files?.[0];
      coverInput.value = "";
      if (!file) return;
      coverError.hidden = true;
      try {
        Object.assign(
          app,
          await api("PATCH", `/applications/${app.id}`, { cover_image: await readFile(file) }),
        );
        renderCover();
        flash(coverStatus, "Image saved.");
      } catch (e) {
        showError(coverError, e);
      }
    });
    const coverCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Rich Presence invite image"),
      el(
        "p",
        { class: "muted" },
        "Shown when someone invites a friend to join what they're doing in your app. Use at least 1024 by 576 pixels.",
      ),
      coverPreview,
      el(
        "div",
        { class: "actions" },
        el(
          "button",
          { class: "btn secondary", type: "button", onclick: () => coverInput.click() },
          "Upload image",
        ),
        coverInput,
        coverStatus,
      ),
      coverError,
    );

    const error = errorLine();
    const status = statusLine();
    const nameInput = el("input", {
      id: "asset-name",
      type: "text",
      maxlength: "32",
      autocomplete: "off",
      placeholder: "large_logo",
    });
    const fileInput = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/gif,image/webp",
      hidden: true,
    });
    let pending;
    const fileLabel = el("span", { class: "hint file-name" }, "No image chosen");
    fileInput.addEventListener("change", () => {
      pending = fileInput.files?.[0];
      fileLabel.textContent = pending ? pending.name : "No image chosen";
      if (pending && !nameInput.value.trim())
        nameInput.value = pending.name
          .replace(/\.[^.]+$/, "")
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .slice(0, 32);
    });
    const grid = el("div", { class: "emoji-grid" });
    const renderAssets = () =>
      grid.replaceChildren(
        ...(assets.length
          ? assets.map((asset) =>
              el(
                "div",
                { class: "emoji-item asset-item" },
                el("img", {
                  src: `${config.cdn}/app-assets/${app.id}/${asset.id}.png?size=160`,
                  alt: "",
                }),
                el("span", { title: asset.name }, asset.name),
                el(
                  "button",
                  {
                    class: "btn secondary",
                    type: "button",
                    "aria-label": `Delete ${asset.name}`,
                    onclick: async () => {
                      const ok = await confirmDialog({
                        title: `Delete ${asset.name}?`,
                        body: "Presences that use this asset name show no image.",
                        action: "Delete asset",
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await api("DELETE", `/oauth2/applications/${app.id}/assets/${asset.id}`);
                        assets.splice(assets.indexOf(asset), 1);
                        renderAssets();
                      } catch (e) {
                        showError(error, e);
                      }
                    },
                  },
                  "Delete",
                ),
              ),
            )
          : [
              el(
                "p",
                { class: "muted" },
                "No assets yet. Upload an image, then use its name as large_image or small_image in your presence.",
              ),
            ]),
      );
    renderAssets();
    const upload = el("button", { class: "btn primary", type: "submit" }, "Upload asset");
    const assetsCard = el(
      "form",
      {
        class: "card",
        onsubmit: async (event) => {
          event.preventDefault();
          error.hidden = true;
          nameInput.removeAttribute("aria-invalid");
          if (!pending) return showError(error, "Choose an image to upload.");
          if (!nameInput.value.trim()) {
            nameInput.setAttribute("aria-invalid", "true");
            nameInput.focus();
            return showError(error, "Give the asset a name.");
          }
          upload.disabled = true;
          try {
            const asset = await api("POST", `/oauth2/applications/${app.id}/assets`, {
              name: nameInput.value.trim(),
              type: 1,
              image: await readFile(pending),
            });
            assets.push(asset);
            renderAssets();
            flash(status, `Uploaded ${asset.name}.`);
            nameInput.value = "";
            pending = undefined;
            fileLabel.textContent = "No image chosen";
          } catch (e) {
            if (/name/i.test(e.field ?? "")) nameInput.setAttribute("aria-invalid", "true");
            showError(error, e);
          } finally {
            upload.disabled = false;
          }
        },
      },
      el("h2", {}, "Rich Presence assets"),
      el(
        "p",
        { class: "muted" },
        "Images your app shows in its Rich Presence, referenced by name. Use at least 512 by 512 pixels.",
      ),
      el(
        "div",
        { class: "field-row" },
        el("div", { class: "field" }, el("label", { for: "asset-name" }, "Asset name"), nameInput),
        el(
          "div",
          { class: "field" },
          el("span", { class: "label" }, "Image"),
          el(
            "div",
            { class: "media-row compact" },
            el(
              "button",
              { class: "btn secondary", type: "button", onclick: () => fileInput.click() },
              "Choose image",
            ),
            fileLabel,
          ),
          fileInput,
        ),
      ),
      el("div", { class: "actions" }, upload, status),
      error,
      grid,
    );
    return [coverCard, assetsCard];
  };

  const renderTesters = async (app) => {
    const testers = await api("GET", `/oauth2/applications/${app.id}/allowlist`);
    const error = errorLine();
    const status = statusLine();
    const input = el("input", {
      id: "tester-username",
      type: "text",
      maxlength: "37",
      autocomplete: "off",
      placeholder: "username",
    });
    const list = el("ul", { class: "member-list", "aria-label": "Testers" });
    const renderList = () =>
      list.replaceChildren(
        ...(testers.length
          ? testers.map((tester) => {
              const src = avatarUrl(tester.user);
              return el(
                "li",
                { class: "member" },
                src
                  ? el("img", { class: "avatar", src, alt: "" })
                  : el(
                      "span",
                      { class: "avatar", "aria-hidden": "true" },
                      tester.user.username.charAt(0).toUpperCase(),
                    ),
                el(
                  "span",
                  { class: "member-name" },
                  el("strong", {}, tester.user.global_name ?? tester.user.username),
                  el("span", { class: "muted" }, tester.user.username),
                ),
                el(
                  "button",
                  {
                    class: "btn secondary",
                    type: "button",
                    "aria-label": `Remove ${tester.user.username}`,
                    onclick: async () => {
                      error.hidden = true;
                      try {
                        await api(
                          "DELETE",
                          `/oauth2/applications/${app.id}/allowlist/${tester.user.id}`,
                        );
                        testers.splice(testers.indexOf(tester), 1);
                        renderList();
                      } catch (e) {
                        showError(error, e);
                      }
                    },
                  },
                  "Remove",
                ),
              );
            })
          : [el("li", { class: "muted" }, "No testers yet.")]),
      );
    renderList();
    const add = el("button", { class: "btn primary", type: "submit" }, "Add tester");
    return [
      el(
        "form",
        {
          class: "card",
          onsubmit: async (event) => {
            event.preventDefault();
            error.hidden = true;
            input.removeAttribute("aria-invalid");
            const username = input.value.trim().replace(/^@/, "");
            if (!username) {
              input.setAttribute("aria-invalid", "true");
              input.focus();
              return showError(error, "Enter the username of a friend.");
            }
            add.disabled = true;
            try {
              const [name, discriminator] = username.split("#");
              const tester = await api("POST", `/oauth2/applications/${app.id}/allowlist`, {
                username: name,
                ...(discriminator && { discriminator }),
              });
              if (!testers.some((entry) => entry.user.id === tester.user.id)) testers.push(tester);
              renderList();
              input.value = "";
              flash(status, `Added ${tester.user.username}.`);
            } catch (e) {
              input.setAttribute("aria-invalid", "true");
              showError(error, e);
            } finally {
              add.disabled = false;
            }
          },
        },
        el("h2", {}, "App testers"),
        el(
          "p",
          { class: "muted" },
          "Testers can launch your activity before you release it to everyone. You can add up to 50 of your friends.",
        ),
        el(
          "div",
          { class: "field" },
          el("label", { for: "tester-username" }, "Username"),
          el("div", { class: "copy-row" }, input, add),
        ),
        status,
        error,
        list,
      ),
    ];
  };

  const renderActivities = async (app) => {
    const version = renderVersion;
    const error = errorLine();
    if (!(app.flags & FLAGS.embedded)) {
      const enable = el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onclick: async () => {
            enable.disabled = true;
            error.hidden = true;
            try {
              Object.assign(
                app,
                await api("PATCH", `/applications/${app.id}`, {
                  flags: app.flags | FLAGS.embedded,
                }),
              );
              if (version !== renderVersion || !enable.isConnected) return;
              await render();
            } catch (e) {
              if (version !== renderVersion || !enable.isConnected) return;
              showError(error, e);
            } finally {
              enable.disabled = false;
            }
          },
        },
        "Enable activities",
      );
      return [
        el(
          "section",
          { class: "card" },
          el("h2", {}, "Activities"),
          el(
            "p",
            { class: "muted" },
            "Activities are web apps people launch together in voice channels and DMs. Enabling them gives your app a Launch command and an address that serves your web app inside the client.",
          ),
          enable,
          error,
        ),
      ];
    }

    const [activityConfig, proxy] = await Promise.all([
      api("GET", `/applications/${app.id}/embedded-activity-config`),
      api("GET", `/applications/${app.id}/proxy-config`),
    ]);
    const host = `${location.protocol}//${app.id}.${config.activityHost || location.host}`;

    const releaseError = errorLine();
    const settingsStatus = statusLine();
    const settingsError = errorLine();
    const platforms = Object.fromEntries(
      [
        ["web", "Web and desktop"],
        ["ios", "iOS"],
        ["android", "Android"],
      ].map(([platform, label]) => [
        platform,
        [
          el("input", {
            type: "checkbox",
            checked: activityConfig.supported_platforms?.includes(platform),
          }),
          label,
        ],
      ]),
    );
    const ageGate = el("input", {
      id: "activity-age-gate",
      type: "checkbox",
      checked: activityConfig.requires_age_gate === true,
    });
    const saveSettings = el("button", { class: "btn primary", type: "submit" }, "Save changes");
    const settingsCard = el(
      "form",
      {
        class: "card",
        onsubmit: async (event) => {
          event.preventDefault();
          settingsError.hidden = true;
          const supported_platforms = Object.entries(platforms)
            .filter(([, [box]]) => box.checked)
            .map(([platform]) => platform);
          if (!supported_platforms.length)
            return showError(settingsError, "Pick at least one platform.");
          saveSettings.disabled = true;
          try {
            await api("PATCH", `/applications/${app.id}/embedded-activity-config`, {
              supported_platforms,
              requires_age_gate: ageGate.checked,
            });
            if (version !== renderVersion || !settingsCard.isConnected) return;
            flash(settingsStatus, "Changes saved.");
          } catch (e) {
            if (version !== renderVersion || !settingsCard.isConnected) return;
            showError(settingsError, e);
          } finally {
            saveSettings.disabled = false;
          }
        },
      },
      el("h2", {}, "Activity settings"),
      el(
        "p",
        { class: "muted" },
        "Your activity loads from this address, which serves the root URL mapping below.",
      ),
      el(
        "div",
        { class: "fields" },
        el(
          "div",
          { class: "field" },
          el("label", { for: "activity-host" }, "Activity URL"),
          el(
            "div",
            { class: "copy-row" },
            el("input", { id: "activity-host", type: "text", readonly: true, value: host }),
            copyButton(() => host),
          ),
        ),
        switchRow(
          "activity-release",
          "Release to everyone",
          "When this is off, only you and your app testers can start the activity. Anyone in the channel can still join a session that's already running.",
          flagToggle(app, "activity-release", FLAGS.embeddedReleased, releaseError),
        ),
        releaseError,
        el(
          "div",
          { class: "check-group" },
          el("h3", {}, "Supported platforms"),
          el(
            "div",
            { class: "check-grid" },
            Object.values(platforms).map(([box, label]) =>
              el("label", { class: "check" }, box, label),
            ),
          ),
        ),
        switchRow(
          "activity-age-gate",
          "Age-restricted activity",
          "Only people who are 18 or older can launch it.",
          ageGate,
        ),
      ),
      el("div", { class: "actions" }, saveSettings, settingsStatus),
      settingsError,
    );

    const byRoot = (a, b) => (a.prefix === "/" ? -1 : b.prefix === "/" ? 1 : 0);
    const mappings = proxy.url_map.map((mapping) => ({ ...mapping }));
    if (!mappings.some((mapping) => mapping.prefix === "/"))
      mappings.unshift({ prefix: "/", target: "" });
    mappings.sort(byRoot);
    const mappingList = el("div", { class: "fields" });
    const mappingStatus = statusLine();
    const mappingError = errorLine();
    const renderMappings = () =>
      mappingList.replaceChildren(
        ...mappings.map((mapping, index) => {
          const root = index === 0;
          const prefix = el("input", {
            id: `mapping-prefix-${index}`,
            type: "text",
            value: mapping.prefix,
            readonly: root,
            placeholder: "/api",
            oninput: () => (mapping.prefix = prefix.value),
          });
          const target = el("input", {
            id: `mapping-target-${index}`,
            type: "text",
            inputmode: "url",
            value: mapping.target,
            placeholder: root ? "app.example.com" : "api.example.com",
            oninput: () => (mapping.target = target.value),
          });
          return el(
            "div",
            { class: "mapping-row" },
            el(
              "div",
              { class: "field" },
              el("label", { for: `mapping-prefix-${index}` }, root ? "Root prefix" : "Prefix"),
              prefix,
            ),
            el(
              "div",
              { class: "field" },
              el("label", { for: `mapping-target-${index}` }, "Target"),
              target,
            ),
            root
              ? el("span", { class: "mapping-spacer", "aria-hidden": "true" })
              : el(
                  "button",
                  {
                    class: "btn secondary",
                    type: "button",
                    "aria-label": `Remove the ${mapping.prefix || "new"} mapping`,
                    onclick: () => {
                      mappings.splice(index, 1);
                      renderMappings();
                    },
                  },
                  "Remove",
                ),
          );
        }),
      );
    renderMappings();
    const saveMappings = el("button", { class: "btn primary", type: "submit" }, "Save changes");
    const mappingsCard = el(
      "form",
      {
        class: "card",
        onsubmit: async (event) => {
          event.preventDefault();
          mappingError.hidden = true;
          mappingList
            .querySelectorAll("input")
            .forEach((input) => input.removeAttribute("aria-invalid"));
          const url_map = mappings.map(({ prefix, target }) => ({
            prefix: prefix.trim(),
            target: target.trim(),
          }));
          const blank = url_map.findIndex(({ prefix, target }) => !prefix || !target);
          if (blank !== -1) {
            const input = document.getElementById(
              `mapping-${url_map[blank].prefix ? "target" : "prefix"}-${blank}`,
            );
            input.setAttribute("aria-invalid", "true");
            input.focus();
            return showError(
              mappingError,
              blank === 0
                ? "Enter the domain your activity is served from."
                : "Fill in both fields or remove the mapping.",
            );
          }
          saveMappings.disabled = true;
          try {
            const saved = await api("PUT", `/applications/${app.id}/proxy-config`, { url_map });
            if (version !== renderVersion || !mappingsCard.isConnected) return;
            mappings.splice(
              0,
              mappings.length,
              ...saved.url_map.map((mapping) => ({ ...mapping })),
            );
            mappings.sort(byRoot);
            renderMappings();
            flash(mappingStatus, "Changes saved.");
          } catch (e) {
            if (version !== renderVersion || !mappingsCard.isConnected) return;
            const [, index, key] = /url_map\.(\d+)\.(prefix|target)/.exec(e.field ?? "") ?? [];
            const input = index && document.getElementById(`mapping-${key}-${index}`);
            if (input) {
              input.setAttribute("aria-invalid", "true");
              input.focus();
            }
            showError(mappingError, e);
          } finally {
            saveMappings.disabled = false;
          }
        },
      },
      el("h2", {}, "URL mappings"),
      el(
        "p",
        { class: "muted" },
        "Your activity can only load content through its own address. Map path prefixes to the domains that serve them, without https://. The longest matching prefix wins.",
      ),
      mappingList,
      el(
        "div",
        { class: "actions" },
        el(
          "button",
          {
            class: "btn secondary",
            type: "button",
            onclick: () => {
              mappings.push({ prefix: "", target: "" });
              renderMappings();
              document.getElementById(`mapping-prefix-${mappings.length - 1}`)?.focus();
            },
          },
          "Add mapping",
        ),
        saveMappings,
        mappingStatus,
      ),
      mappingError,
    );

    const disableError = errorLine();
    const disable = el(
      "button",
      {
        class: "btn danger",
        type: "button",
        onclick: async () => {
          const ok = await confirmDialog({
            title: "Disable activities?",
            body: "People can no longer launch your activity, and running sessions stop loading. Your settings and URL mappings are kept.",
            action: "Disable activities",
            danger: true,
          });
          if (!ok || version !== renderVersion || !disable.isConnected || disable.disabled) return;
          disable.disabled = true;
          try {
            Object.assign(
              app,
              await api("PATCH", `/applications/${app.id}`, {
                flags: app.flags & ~(FLAGS.embedded | FLAGS.embeddedReleased),
              }),
            );
            if (version !== renderVersion || !disable.isConnected) return;
            await render();
          } catch (e) {
            if (version !== renderVersion || !disable.isConnected) return;
            showError(disableError, e);
          } finally {
            disable.disabled = false;
          }
        },
      },
      "Disable activities",
    );
    const disableCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Disable activities"),
      el("p", { class: "muted" }, "Turn activities off without losing your settings."),
      disable,
      disableError,
    );
    return [settingsCard, mappingsCard, disableCard];
  };

  // Profile widgets. Text fields hold fixed text, or {{key}} to show a value the app sets per user.
  const DATA_FIELD = /^\{\{\s*([A-Za-z0-9_]{1,32})\s*\}\}$/;
  const assetUrl = (app, asset, size = 256) =>
    `${config.cdn}/app-assets/${app.id}/${asset.asset_id}.png?size=${size}`;

  const textField = (text) => {
    const value = (text ?? "").trim();
    if (!value) return null;
    const key = DATA_FIELD.exec(value)?.[1];
    return key
      ? { value_type: "data", presentation_type: "text", value: key }
      : { value_type: "custom_string", presentation_type: "text", value };
  };
  const numberField = (text) => {
    const key = DATA_FIELD.exec((text ?? "").trim())?.[1];
    return key ? { value_type: "data", presentation_type: "number", value: key } : null;
  };
  const imageField = (key) =>
    key ? { value_type: "application_asset", presentation_type: "image", value: key } : null;
  const fieldText = (field) =>
    !field
      ? ""
      : field.value_type === "data"
        ? `{{${field.value}}}`
        : field.value_type === "custom_string"
          ? field.value
          : "";
  const fieldImage = (field) => (field?.value_type === "application_asset" ? field.value : null);
  const component = (fields) => {
    const kept = Object.fromEntries(Object.entries(fields).filter(([, field]) => field));
    return Object.keys(kept).length ? { fields: kept } : null;
  };

  const widgetState = (surfaces = {}) => {
    const top = surfaces.widget_top;
    const bottom = surfaces.widget_bottom;
    const mini = surfaces.mini_profile;
    const c = (surface, name) => surface?.components?.[name]?.fields ?? {};
    const topHero = top?.layout !== "widget_top_contained";
    const miniHero = mini?.layout === "mini_profile_hero_stat";
    return {
      top: {
        layout: topHero ? "hero" : "contained",
        title: fieldText(c(top, "title").text),
        subtitles: [1, 2, 3].map((i) => fieldText(c(top, `subtitle_${i}`).text)),
        image: fieldImage(c(top, topHero ? "hero_image" : "contained_image").image),
      },
      bottom: {
        layout:
          { widget_bottom_stats: "stats", widget_bottom_progress: "progress" }[bottom?.layout] ??
          "collection",
        items: [1, 2, 3, 4].map((i) => ({
          image: fieldImage(c(bottom, `item_${i}`).image),
          name: fieldText(c(bottom, `item_${i}`).name),
          description: fieldText(c(bottom, `item_${i}`).description),
        })),
        stats: [1, 2, 3, 4, 5, 6].map((i) => ({
          value: fieldText(c(bottom, `stat_${i}`).value),
          label: fieldText(c(bottom, `stat_${i}`).label),
        })),
        progress: {
          image: fieldImage(c(bottom, "objective").image),
          name: fieldText(c(bottom, "objective").name),
          description: fieldText(c(bottom, "objective").description),
          current: fieldText(c(bottom, "progress").current),
          max: fieldText(c(bottom, "progress").max),
        },
      },
      mini: {
        enabled: !top || !!mini,
        layout: miniHero ? "hero" : "contained",
        stat: fieldText(c(mini, "stat").text),
        image: fieldImage(c(mini, miniHero ? "hero_image" : "contained_image").image),
      },
    };
  };

  const widgetSurfaces = (state) => {
    const { top, bottom, mini } = state;
    const topImage = top.layout === "hero" ? "hero_image" : "contained_image";
    const bottomSurface =
      bottom.layout === "stats"
        ? {
            layout: "widget_bottom_stats",
            components: Object.fromEntries(
              bottom.stats.map((stat, i) => [
                `stat_${i + 1}`,
                component({ value: textField(stat.value), label: textField(stat.label) }),
              ]),
            ),
          }
        : bottom.layout === "progress"
          ? {
              layout: "widget_bottom_progress",
              components: {
                objective: component({
                  image: imageField(bottom.progress.image),
                  name: textField(bottom.progress.name),
                  description: textField(bottom.progress.description),
                }),
                progress: component({
                  current: numberField(bottom.progress.current),
                  max: numberField(bottom.progress.max),
                }),
              },
            }
          : {
              layout: "widget_bottom_collection",
              components: Object.fromEntries(
                bottom.items.map((item, i) => [
                  `item_${i + 1}`,
                  component({
                    image: imageField(item.image),
                    name: textField(item.name),
                    description: textField(item.description),
                  }),
                ]),
              ),
            };
    const miniImage = mini.layout === "hero" ? "hero_image" : "contained_image";
    return {
      widget_top: {
        layout: top.layout === "hero" ? "widget_top_hero" : "widget_top_contained",
        components: {
          title: component({ text: textField(top.title) }),
          ...Object.fromEntries(
            top.subtitles.map((text, i) => [
              `subtitle_${i + 1}`,
              component({ text: textField(text) }),
            ]),
          ),
          [topImage]: component({ image: imageField(top.image) }),
        },
      },
      widget_bottom: bottomSurface,
      mini_profile: mini.enabled
        ? {
            layout:
              mini.layout === "hero" ? "mini_profile_hero_stat" : "mini_profile_contained_stat",
            components: {
              stat: component({ text: textField(mini.stat) }),
              [miniImage]: component({ image: imageField(mini.image ?? top.image) }),
            },
          }
        : null,
    };
  };

  // The client leaves a loading placeholder wherever a layout's required text is missing, so those are checked before saving.
  const widgetProblems = (state) => {
    const problems = [];
    const blank = (text) => !(text ?? "").trim();
    if (blank(state.top.title))
      problems.push(["widget-title", "Give the top of your widget a title."]);
    if (state.bottom.layout === "collection")
      state.bottom.items.forEach((item, i) => {
        if (blank(item.name))
          problems.push([`widget-item-${i}-name`, `Give item ${i + 1} a name.`]);
        else if (blank(item.description))
          problems.push([`widget-item-${i}-description`, `Give item ${i + 1} a description.`]);
      });
    if (state.bottom.layout === "stats")
      state.bottom.stats.forEach(
        (stat, i) =>
          blank(stat.value) &&
          problems.push([
            `widget-stat-${i}-value`,
            `Give stat ${i + 1} a value. This layout always shows six.`,
          ]),
      );
    if (state.bottom.layout === "progress") {
      if (blank(state.bottom.progress.name))
        problems.push(["widget-progress-name", "Name the goal."]);
      else if (blank(state.bottom.progress.description))
        problems.push(["widget-progress-description", "Describe the goal."]);
      if (!numberField(state.bottom.progress.current))
        problems.push([
          "widget-progress-current",
          "Progress comes from your data. Enter a key like {{level}}.",
        ]);
      if (!blank(state.bottom.progress.max) && !numberField(state.bottom.progress.max))
        problems.push([
          "widget-progress-max",
          "The goal comes from your data too. Enter a key like {{max_level}}.",
        ]);
    }
    if (state.mini.enabled && blank(state.mini.stat))
      problems.push(["widget-mini-stat", "Add the line shown on your profile popout."]);
    return problems;
  };

  const dataKeys = (state) => [
    ...new Set(
      JSON.stringify(state)
        .match(/\{\{\s*[A-Za-z0-9_]{1,32}\s*\}\}/g)
        ?.map((x) => x.replace(/[{}\s]/g, "")) ?? [],
    ),
  ];

  const renderWidget = async (app) => {
    const version = renderVersion;
    const [saved, board, identity] = await Promise.all([
      api("GET", `/applications/${app.id}/widget-config`),
      api("GET", "/users/@me/widgets"),
      api("GET", `/applications/${app.id}/users/@me/widget-data`),
    ]);
    let savedConfig = saved.config;
    const assets = new Map((savedConfig?.assets ?? []).map((asset) => [asset.key, asset]));
    const state = widgetState(savedConfig?.surfaces);
    const isSaved = () => !!savedConfig?.surfaces?.widget_top;
    let widgets = board.widgets ?? [];
    const onProfile = () =>
      widgets.some(
        (widget) => widget.data?.type === "application" && widget.data.application_id === app.id,
      );
    const values = { ...identity.data };

    // Preview, drawn after the client's own layouts.
    const preview = el("div", { class: "wp-stage", "aria-label": "Preview" });
    const resolveText = (text) => {
      const key = DATA_FIELD.exec((text ?? "").trim())?.[1];
      if (!key) return { text: (text ?? "").trim(), data: false };
      return values[key] != null
        ? { text: String(values[key]), data: false }
        : { text: `{{${key}}}`, data: true };
    };
    const previewText = (tag, cls, text, fallback) => {
      const { text: value, data } = resolveText(text);
      if (!value && !fallback) return null;
      return el(
        tag,
        { class: `${cls}${data ? " wp-data" : ""}${value ? "" : " wp-empty"}` },
        value || fallback,
      );
    };
    const previewImage = (key, cls) => {
      const asset = key && assets.get(key);
      return asset
        ? el("img", { class: cls, src: assetUrl(app, asset, 512), alt: "" })
        : el("span", { class: `${cls} wp-placeholder`, "aria-hidden": "true" });
    };
    const previewHeader = () =>
      el(
        "div",
        { class: "wp-head" },
        iconUrl(app)
          ? el("img", { class: "wp-app-icon", src: iconUrl(app), alt: "" })
          : el("span", { class: "wp-app-icon" }),
        el("span", {}, app.name),
      );
    const drawPreview = () => {
      const { top, bottom, mini } = state;
      const headline = el(
        "div",
        { class: "wp-headline" },
        previewText("strong", "wp-title", top.title, "Title"),
        top.subtitles.map((text) => previewText("span", "wp-subtitle", text)),
      );
      const topBlock =
        top.layout === "hero"
          ? el(
              "div",
              { class: "wp-top wp-top-hero" },
              el("div", { class: "wp-top-text" }, previewHeader(), headline),
              previewImage(top.image, "wp-hero-image"),
            )
          : el(
              "div",
              { class: "wp-top" },
              previewHeader(),
              el(
                "div",
                { class: "wp-top-row" },
                headline,
                previewImage(top.image, "wp-contained-image"),
              ),
            );
      let bottomBlock;
      if (bottom.layout === "stats")
        bottomBlock = el(
          "div",
          { class: "wp-stats" },
          bottom.stats.map((stat) =>
            el(
              "div",
              { class: "wp-stat" },
              previewText("strong", "wp-stat-value", stat.value, "Value"),
              previewText("span", "wp-muted", stat.label),
            ),
          ),
        );
      else if (bottom.layout === "progress") {
        const progress = bottom.progress;
        const current = Number(resolveText(progress.current).text);
        const max = Number(resolveText(progress.max).text);
        const percent = Number.isFinite(current)
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round(Number.isFinite(max) && max ? (current / max) * 100 : current * 100),
              ),
            )
          : 0;
        bottomBlock = el(
          "div",
          { class: "wp-progress" },
          previewImage(progress.image, "wp-item-image"),
          el(
            "div",
            { class: "wp-progress-body" },
            el("div", { class: "wp-bar" }, el("span", { style: `width:${percent}%` })),
            el(
              "div",
              { class: "wp-progress-row" },
              el(
                "div",
                { class: "wp-item-text" },
                previewText("strong", "wp-item-name", progress.name, "Goal"),
                previewText("span", "wp-muted", progress.description, "Description"),
              ),
              el(
                "span",
                { class: "wp-progress-count" },
                progress.max.trim()
                  ? `${resolveText(progress.current).text}/${resolveText(progress.max).text}`
                  : `${percent}%`,
              ),
            ),
          ),
        );
      } else
        bottomBlock = el(
          "div",
          { class: "wp-items" },
          bottom.items.map((item) =>
            el(
              "div",
              { class: "wp-item" },
              previewImage(item.image, "wp-item-image"),
              el(
                "div",
                { class: "wp-item-text" },
                previewText("strong", "wp-item-name", item.name, "Name"),
                previewText("span", "wp-muted", item.description, "Description"),
              ),
            ),
          ),
        );
      const miniImage = mini.image ?? top.image;
      const miniCard = mini.enabled
        ? el(
            "figure",
            { class: "wp-figure" },
            el(
              "div",
              { class: `wp-card wp-mini${mini.layout === "hero" ? " wp-mini-hero" : ""}` },
              el(
                "div",
                { class: "wp-mini-text" },
                previewHeader(),
                previewText("strong", "wp-mini-stat", mini.stat, "Your line"),
                el("span", { class: "wp-link" }, "View All Stats"),
              ),
              mini.layout === "hero"
                ? previewImage(miniImage, "wp-mini-hero-image")
                : previewImage(miniImage, "wp-mini-image"),
            ),
            el("figcaption", { class: "hint" }, "Profile popout"),
          )
        : null;
      preview.replaceChildren(
        el(
          "figure",
          { class: "wp-figure wp-figure-main" },
          el("div", { class: "wp-card" }, topBlock, el("hr", { class: "wp-divider" }), bottomBlock),
          el("figcaption", { class: "hint" }, "Board tab of your profile"),
        ),
        miniCard,
      );
    };

    // Form controls.
    const errorNode = errorLine();
    const status = statusLine();
    const text = (id, label, get, set, attrs = {}) => {
      const input = el("input", {
        id,
        type: "text",
        maxlength: "256",
        autocomplete: "off",
        value: get(),
        ...attrs,
      });
      input.addEventListener("input", () => {
        set(input.value);
        input.removeAttribute("aria-invalid");
        drawPreview();
      });
      return el("div", { class: "field" }, el("label", { for: id }, label), input);
    };
    const imagePicker = (id, label, get, set, hint) => {
      let imageRequestVersion = 0;
      const fileInput = el("input", {
        type: "file",
        accept: "image/png,image/jpeg,image/gif,image/webp",
        hidden: true,
      });
      const thumb = el("span", { class: "wp-thumb" });
      const remove = el(
        "button",
        { class: "btn secondary", type: "button", "aria-label": `Remove ${label.toLowerCase()}` },
        "Remove",
      );
      const upload = el(
        "button",
        { class: "btn secondary", type: "button", id, onclick: () => fileInput.click() },
        "Upload image",
      );
      const sync = () => {
        const asset = get() && assets.get(get());
        thumb.replaceChildren(
          asset
            ? el("img", { src: assetUrl(app, asset, 128), alt: "" })
            : el("span", { class: "wp-placeholder" }),
        );
        upload.textContent = asset ? "Replace" : "Upload image";
        remove.hidden = !asset;
      };
      remove.addEventListener("click", () => {
        imageRequestVersion++;
        upload.disabled = false;
        set(null);
        sync();
        drawPreview();
        syncWidgetDraftStatus();
      });
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (!file) return;
        const request = ++imageRequestVersion;
        errorNode.hidden = true;
        upload.disabled = true;
        try {
          const image = await readFile(file);
          if (version !== renderVersion || request !== imageRequestVersion || !upload.isConnected)
            return;
          const asset = await api("POST", `/applications/${app.id}/widget-config/assets`, {
            image,
          });
          if (version !== renderVersion || request !== imageRequestVersion || !upload.isConnected)
            return;
          assets.set(asset.key, asset);
          set(asset.key);
          sync();
          drawPreview();
          syncWidgetDraftStatus();
        } catch (e) {
          if (version !== renderVersion || request !== imageRequestVersion || !upload.isConnected)
            return;
          showError(errorNode, e);
        } finally {
          if (request === imageRequestVersion) upload.disabled = false;
        }
      });
      sync();
      return el(
        "div",
        { class: "field" },
        el("label", { for: id }, label),
        el("div", { class: "media-row compact" }, thumb, upload, remove, fileInput),
        hint && el("p", { class: "hint" }, hint),
      );
    };
    const radios = (name, label, options, get, set, onChange) =>
      el(
        "div",
        { class: "field" },
        el("span", { class: "label", id: `${name}-label` }, label),
        el(
          "div",
          { class: "radio-list", role: "radiogroup", "aria-labelledby": `${name}-label` },
          options.map(([value, text]) => {
            const radio = el("input", { type: "radio", name, value, checked: get() === value });
            radio.addEventListener("change", () => {
              set(value);
              onChange?.();
              drawPreview();
            });
            return el("label", { class: "check" }, radio, text);
          }),
        ),
      );

    const topCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Top"),
      el(
        "p",
        { class: "muted" },
        "A greeting and up to three lines under it, with an image on the side.",
      ),
      el(
        "div",
        { class: "fields" },
        radios(
          "widget-top-layout",
          "Image style",
          [
            ["hero", "Large, cut out"],
            ["contained", "Square"],
          ],
          () => state.top.layout,
          (v) => (state.top.layout = v),
        ),
        text(
          "widget-title",
          "Title",
          () => state.top.title,
          (v) => (state.top.title = v),
          { placeholder: "Hello! 👋" },
        ),
        state.top.subtitles.map((_, i) =>
          text(
            `widget-subtitle-${i}`,
            `Line ${i + 1}`,
            () => state.top.subtitles[i],
            (v) => (state.top.subtitles[i] = v),
            i === 0 ? { placeholder: "Welcome to my profile!" } : {},
          ),
        ),
        imagePicker(
          "widget-top-image",
          "Image",
          () => state.top.image,
          (v) => (state.top.image = v),
          "PNGs with a transparent background work best for the large style.",
        ),
      ),
    );

    const bottomFields = el("div", { class: "fields" });
    const drawBottomFields = () => {
      const { bottom } = state;
      bottomFields.replaceChildren(
        ...(bottom.layout === "collection"
          ? bottom.items.map((item, i) =>
              el(
                "fieldset",
                { class: "wp-group" },
                el("legend", {}, `Item ${i + 1}`),
                el(
                  "div",
                  { class: "fields" },
                  imagePicker(
                    `widget-item-${i}-image`,
                    "Icon",
                    () => item.image,
                    (v) => (item.image = v),
                  ),
                  el(
                    "div",
                    { class: "field-row" },
                    text(
                      `widget-item-${i}-name`,
                      "Name",
                      () => item.name,
                      (v) => (item.name = v),
                      i === 0 ? { placeholder: "Video editor" } : {},
                    ),
                    text(
                      `widget-item-${i}-description`,
                      "Description",
                      () => item.description,
                      (v) => (item.description = v),
                      i === 0 ? { placeholder: "for over 10 years" } : {},
                    ),
                  ),
                ),
              ),
            )
          : bottom.layout === "stats"
            ? bottom.stats.map((stat, i) =>
                el(
                  "div",
                  { class: "field-row" },
                  text(
                    `widget-stat-${i}-value`,
                    `Stat ${i + 1}`,
                    () => stat.value,
                    (v) => (stat.value = v),
                    i === 0 ? { placeholder: "10M+" } : {},
                  ),
                  text(
                    `widget-stat-${i}-label`,
                    "Label",
                    () => stat.label,
                    (v) => (stat.label = v),
                    i === 0 ? { placeholder: "Visits" } : {},
                  ),
                ),
              )
            : [
                imagePicker(
                  "widget-progress-image",
                  "Icon",
                  () => bottom.progress.image,
                  (v) => (bottom.progress.image = v),
                ),
                el(
                  "div",
                  { class: "field-row" },
                  text(
                    "widget-progress-name",
                    "Goal",
                    () => bottom.progress.name,
                    (v) => (bottom.progress.name = v),
                    { placeholder: "Reach level 50" },
                  ),
                  text(
                    "widget-progress-description",
                    "Description",
                    () => bottom.progress.description,
                    (v) => (bottom.progress.description = v),
                    { placeholder: "Season 3" },
                  ),
                ),
                el(
                  "div",
                  { class: "field-row" },
                  text(
                    "widget-progress-current",
                    "Progress",
                    () => bottom.progress.current,
                    (v) => (bottom.progress.current = v),
                    { placeholder: "{{level}}" },
                  ),
                  text(
                    "widget-progress-max",
                    "Goal value (optional)",
                    () => bottom.progress.max,
                    (v) => (bottom.progress.max = v),
                    { placeholder: "{{max_level}}" },
                  ),
                ),
                el(
                  "p",
                  { class: "hint" },
                  "Progress is a number, so it always comes from your data. Without a goal value, progress is read as a fraction, where 0.5 is half full.",
                ),
              ]),
      );
    };
    drawBottomFields();
    const bottomCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Bottom"),
      el("p", { class: "muted" }, "Four things about you, six stats, or a progress bar."),
      el(
        "div",
        { class: "fields" },
        radios(
          "widget-bottom-layout",
          "Layout",
          [
            ["collection", "Four items"],
            ["stats", "Six stats"],
            ["progress", "Progress"],
          ],
          () => state.bottom.layout,
          (v) => (state.bottom.layout = v),
          drawBottomFields,
        ),
        bottomFields,
      ),
    );

    const miniToggle = el("input", {
      id: "widget-mini-enabled",
      type: "checkbox",
      checked: state.mini.enabled,
    });
    const miniFields = el(
      "div",
      { class: "fields" },
      radios(
        "widget-mini-layout",
        "Image style",
        [
          ["contained", "Square"],
          ["hero", "Large"],
        ],
        () => state.mini.layout,
        (v) => (state.mini.layout = v),
      ),
      text(
        "widget-mini-stat",
        "Line",
        () => state.mini.stat,
        (v) => (state.mini.stat = v),
        { placeholder: "Welcome to my profile!" },
      ),
      imagePicker(
        "widget-mini-image",
        "Image",
        () => state.mini.image,
        (v) => (state.mini.image = v),
        "Leave it empty to reuse the image from the top.",
      ),
    );
    miniFields.hidden = !state.mini.enabled;
    miniToggle.addEventListener("change", () => {
      state.mini.enabled = miniToggle.checked;
      miniFields.hidden = !miniToggle.checked;
      drawPreview();
    });
    const miniCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Profile popout"),
      el(
        "p",
        { class: "muted" },
        "A smaller card in your profile popout that opens the full widget.",
      ),
      el(
        "div",
        { class: "fields" },
        switchRow("widget-mini-enabled", "Show a card in the profile popout", null, miniToggle),
        miniFields,
      ),
    );

    const publicToggle = el("input", {
      id: "widget-public",
      type: "checkbox",
      checked: saved.public,
    });
    const widgetDraft = () =>
      JSON.stringify({ surfaces: widgetSurfaces(state), public: publicToggle.checked });
    let savedDraft = widgetDraft();
    const syncWidgetDraftStatus = () => {
      if (!savedConfig) return;
      if (widgetDraft() !== savedDraft) status.textContent = "You have unsaved changes.";
      else if (status.textContent === "You have unsaved changes.") status.textContent = "";
    };
    const retainedImages = () =>
      [
        state.top.image,
        ...state.bottom.items.map((item) => item.image),
        state.bottom.progress.image,
        state.mini.image,
      ].filter(Boolean);
    let profilePending = false;
    const profileButton = el("button", { class: "btn secondary", type: "button" });
    const profileStatus = statusLine();
    const profileError = errorLine();
    const syncProfileButton = () => {
      profileButton.textContent = onProfile() ? "Remove from my profile" : "Add to my profile";
      profileButton.className = `btn ${onProfile() ? "secondary" : "primary"}`;
      profileButton.disabled = profilePending || !isSaved();
    };
    profileButton.addEventListener("click", async () => {
      if (profilePending || !isSaved() || version !== renderVersion || !profileButton.isConnected)
        return;
      profilePending = true;
      profileError.hidden = true;
      profileButton.disabled = true;
      const adding = !onProfile();
      try {
        const next = adding
          ? [...widgets, { data: { type: "application", application_id: app.id } }]
          : widgets.filter(
              (widget) =>
                !(widget.data?.type === "application" && widget.data.application_id === app.id),
            );
        const result = await api("PUT", "/users/@me/widgets", { widgets: next });
        if (version !== renderVersion || !profileButton.isConnected) return;
        widgets = result.widgets;
        flash(profileStatus, adding ? "Added to your profile." : "Removed from your profile.");
      } catch (e) {
        if (version !== renderVersion || !profileButton.isConnected) return;
        showError(profileError, e);
      } finally {
        profilePending = false;
        if (version === renderVersion && profileButton.isConnected) syncProfileButton();
        else profileButton.disabled = false;
      }
    });

    const save = el("button", { class: "btn primary", type: "submit" }, "Save widget");
    const form = el(
      "form",
      {
        class: "wp-editor",
        onsubmit: async (event) => {
          event.preventDefault();
          errorNode.hidden = true;
          form
            .querySelectorAll("[aria-invalid]")
            .forEach((node) => node.removeAttribute("aria-invalid"));
          const problems = widgetProblems(state);
          if (problems.length) {
            const [id, message] = problems[0];
            const input = document.getElementById(id);
            input?.setAttribute("aria-invalid", "true");
            input?.focus();
            return showError(errorNode, message);
          }
          save.disabled = true;
          const submittedDraft = widgetDraft();
          try {
            const result = await api("PUT", `/applications/${app.id}/widget-config`, {
              surfaces: widgetSurfaces(state),
              public: publicToggle.checked,
              asset_keys: [...assets.keys()],
              retained_asset_keys: [...new Set(retainedImages())],
            });
            if (version !== renderVersion || !form.isConnected) return;
            savedConfig = result.config;
            savedDraft = submittedDraft;
            assets.clear();
            savedConfig.assets.forEach((asset) => assets.set(asset.key, asset));
            syncProfileButton();
            drawKeys();
            flash(
              status,
              widgetDraft() !== submittedDraft
                ? "Widget saved. You have unsaved changes."
                : onProfile()
                  ? "Widget saved. It's live on your profile."
                  : "Widget saved. Add it to your profile below.",
            );
          } catch (e) {
            if (version !== renderVersion || !form.isConnected) return;
            showError(errorNode, e);
          } finally {
            save.disabled = false;
          }
        },
      },
      topCard,
      bottomCard,
      miniCard,
      el(
        "section",
        { class: "card" },
        el("h2", {}, "Who can use it"),
        el(
          "div",
          { class: "fields" },
          switchRow(
            "widget-public",
            "Let anyone add this widget",
            "Leave this off for a widget about you. Turn it on when your app fills in {{keys}} for each person, so everyone can show their own values.",
            publicToggle,
          ),
        ),
      ),
      el("div", { class: "actions wp-save" }, save, status),
      errorNode,
    );

    form.addEventListener("input", syncWidgetDraftStatus);
    form.addEventListener("change", syncWidgetDraftStatus);

    const profileCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Your profile"),
      el(
        "p",
        { class: "muted" },
        "Show this widget on the Board tab of your profile. You can also add it from Edit Profile in the app.",
      ),
      el("div", { class: "actions" }, profileButton, profileStatus),
      profileError,
    );
    syncProfileButton();

    // Values for {{keys}} on your own profile.
    let valueEditVersion = 0;
    const rows = Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));
    const keyHint = el("p", { class: "hint" });
    const drawKeys = () => {
      const keys = dataKeys(state);
      const missing = keys.filter((key) => !rows.some((row) => row.key === key));
      keyHint.textContent = keys.length
        ? `Your widget reads ${keys.map((key) => `{{${key}}}`).join(", ")}.${missing.length ? ` Not set yet: ${missing.join(", ")}.` : ""}`
        : "Your widget doesn't read any data yet. Type {{key}} in a text field to show a value from here.";
    };
    const rowList = el("div", { class: "fields" });
    const drawRows = () =>
      rowList.replaceChildren(
        ...rows.map((row, index) => {
          const key = el("input", {
            type: "text",
            maxlength: "32",
            placeholder: "visits",
            value: row.key,
            "aria-label": `Key ${index + 1}`,
          });
          const value = el("input", {
            type: "text",
            maxlength: "256",
            placeholder: "10M+",
            value: row.value,
            "aria-label": `Value ${index + 1}`,
          });
          key.addEventListener("input", () => {
            if (row.key === key.value.trim()) return;
            row.key = key.value.trim();
            valueEditVersion++;
          });
          value.addEventListener("input", () => {
            if (row.value === value.value) return;
            row.value = value.value;
            valueEditVersion++;
          });
          return el(
            "div",
            { class: "wp-data-row" },
            key,
            value,
            el(
              "button",
              {
                class: "btn secondary",
                type: "button",
                "aria-label": `Remove ${row.key || "row"}`,
                onclick: () => {
                  rows.splice(index, 1);
                  valueEditVersion++;
                  drawRows();
                },
              },
              "Remove",
            ),
          );
        }),
        ...(rows.length ? [] : [el("p", { class: "muted" }, "No values yet.")]),
      );
    drawRows();
    drawKeys();
    const dataStatus = statusLine();
    const dataError = errorLine();
    const saveData = el("button", { class: "btn primary", type: "submit" }, "Save values");
    const dataCard = el(
      "form",
      {
        class: "card",
        onsubmit: async (event) => {
          event.preventDefault();
          dataError.hidden = true;
          const data = Object.fromEntries(
            rows
              .filter((row) => row.key)
              .map((row) => [
                row.key,
                /^-?\d+(\.\d+)?$/.test(row.value.trim()) ? Number(row.value) : row.value,
              ]),
          );
          saveData.disabled = true;
          const editVersion = valueEditVersion;
          try {
            const result = await api("PUT", `/applications/${app.id}/users/@me/widget-data`, {
              data,
            });
            if (version !== renderVersion || !dataCard.isConnected) return;
            Object.keys(values).forEach((key) => delete values[key]);
            Object.assign(values, result.data);
            if (editVersion === valueEditVersion) {
              rows.splice(
                0,
                rows.length,
                ...Object.entries(values).map(([key, value]) => ({ key, value: String(value) })),
              );
              drawRows();
            }
            drawKeys();
            drawPreview();
            flash(
              dataStatus,
              editVersion === valueEditVersion
                ? "Values saved."
                : "Values saved. You have unsaved changes.",
            );
          } catch (e) {
            if (version !== renderVersion || !dataCard.isConnected) return;
            showError(dataError, e);
          } finally {
            saveData.disabled = false;
          }
        },
      },
      el("h2", {}, "Your values"),
      el(
        "p",
        { class: "muted" },
        "What {{keys}} show on your own profile. Numbers are formatted for each reader's language.",
      ),
      keyHint,
      el("div", { class: "wp-data-list" }, rowList),
      el(
        "div",
        { class: "actions" },
        el(
          "button",
          {
            class: "btn secondary",
            type: "button",
            onclick: () => {
              if (rows.length >= 50) return showError(dataError, "You can set up to 50 values.");
              rows.push({ key: "", value: "" });
              valueEditVersion++;
              drawRows();
              rowList.querySelectorAll("input")[rows.length * 2 - 2]?.focus();
            },
          },
          "Add value",
        ),
        saveData,
        dataStatus,
      ),
      dataError,
    );

    const endpoint = `${location.origin}/api/v9/applications/${app.id}/users/{user_id}/widget-data`;
    const example = `curl -X PATCH "${endpoint.replace("{user_id}", "USER_ID")}" \\\n  -H "Authorization: Bot $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"data": {"visits": "10M+", "level": 12}}'`;
    const apiCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Update values from your bot"),
      el(
        "p",
        { class: "muted" },
        "Your bot can keep anyone's values up to date with its token. PATCH changes the keys you send and removes keys set to null, PUT replaces them all, GET reads them and DELETE clears them. Sending values for someone also lets them add the widget.",
      ),
      el(
        "div",
        { class: "fields" },
        copyField("Endpoint", endpoint),
        el(
          "div",
          { class: "field" },
          el("span", { class: "label" }, "Example"),
          el("pre", { class: "wp-code" }, example),
          el(
            "div",
            {},
            copyButton(() => example, "Copy example"),
          ),
        ),
      ),
    );

    const removeError = errorLine();
    const remove = el(
      "button",
      {
        class: "btn danger",
        type: "button",
        onclick: async () => {
          const ok = await confirmDialog({
            title: "Delete this widget?",
            body: "It disappears from every profile that shows it. You can't undo this.",
            action: "Delete widget",
            danger: true,
          });
          if (!ok || version !== renderVersion || !remove.isConnected || remove.disabled) return;
          remove.disabled = true;
          try {
            await api("DELETE", `/applications/${app.id}/widget-config`);
            if (version !== renderVersion || !remove.isConnected) return;
            await render();
          } catch (e) {
            if (version !== renderVersion || !remove.isConnected) return;
            showError(removeError, e);
          } finally {
            remove.disabled = false;
          }
        },
      },
      "Delete widget",
    );
    const removeCard = el(
      "section",
      { class: "card" },
      el("h2", {}, "Delete widget"),
      el(
        "p",
        { class: "muted" },
        "Removes the widget from every profile that shows it and deletes its images. Values your app set are kept.",
      ),
      remove,
      removeError,
    );
    removeCard.hidden = !savedConfig;

    drawPreview();
    const intro = el(
      "p",
      { class: "muted page-lead" },
      "Build a card for the Board tab of your profile, like the ones games and apps add. Type {{key}} in any text field to show a value you or your bot set for each person.",
    );
    return [
      intro,
      el(
        "div",
        { class: "wp-layout" },
        el("div", { class: "wp-main" }, form, profileCard, dataCard, apiCard, removeCard),
        el("aside", { class: "wp-aside" }, preview),
      ),
    ];
  };

  const SECTIONS = {
    information: ["General information", renderInformation],
    installation: ["Installation", renderInstallation],
    oauth2: ["OAuth2", renderOAuth],
    bot: ["Bot", renderBot],
    emojis: ["Emojis", renderEmojis],
    "rich-presence": ["Rich Presence", renderRichPresence],
    widget: ["Profile Widget", renderWidget],
    testers: ["App Testers", renderTesters],
    activities: ["Activities", renderActivities],
  };

  const renderApp = async (id, section) => {
    const version = renderVersion;
    if (!SECTIONS[section]) return navigate(`/developers/applications/${id}/information`, true);
    view.replaceChildren(el("p", { class: "loading" }, "Loading application"));
    let app;
    try {
      app = await api("GET", `/applications/${id}`);
    } catch (e) {
      if (version !== renderVersion) return;
      setNav(null);
      view.replaceChildren(
        el(
          "div",
          { class: "empty" },
          el("h2", {}, "Application not found"),
          el("p", { class: "muted" }, e.message),
          el(
            "a",
            { class: "btn primary", href: "/developers/applications", "data-link": true },
            "Go to your applications",
          ),
        ),
      );
      return;
    }
    if (version !== renderVersion) return;
    const [title, renderSection] = SECTIONS[section];
    const content = await renderSection(app);
    if (version !== renderVersion) return;
    setNav(app, section);
    document.title = `${title} | ${app.name} | ${config.instanceName} Developer Portal`;
    view.replaceChildren(
      el("div", { class: "page-head app-head" }, el("h1", {}, app.name)),
      ...content,
    );
  };

  const render = async () => {
    const version = ++renderVersion;
    currentBotToken = null;
    currentClientSecret = null;
    for (const dialog of document.querySelectorAll("dialog[open]")) {
      dialog.close("cancel");
      dialog.remove();
    }
    const path = location.pathname.replace(/\/+$/, "");
    const match = path.match(/^\/developers\/applications\/(\d+)(?:\/([\w-]+))?$/);
    try {
      if (match) await renderApp(match[1], match[2] ?? "information");
      else if (path === "/developers/applications") await renderList();
      else navigate("/developers/applications", true);
    } catch (e) {
      if (version !== renderVersion) return;
      view.replaceChildren(
        el(
          "div",
          { class: "empty" },
          el("h2", {}, "Something went wrong"),
          el("p", { class: "error", role: "alert" }, e.message),
        ),
      );
    }
    if (version !== renderVersion) return;
    view.focus({ preventScroll: true });
  };

  render();
})();
