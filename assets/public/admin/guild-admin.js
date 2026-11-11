"use strict";

const TIMEOUT_CHOICES = [
  [60, "60 seconds"],
  [300, "5 minutes"],
  [600, "10 minutes"],
  [3600, "1 hour"],
  [86400, "1 day"],
  [604800, "1 week"],
  [2419200, "28 days"],
];

const BAN_DELETE_CHOICES = [
  [0, "Keep their messages"],
  [3600, "Delete the last hour"],
  [86400, "Delete the last 24 hours"],
  [604800, "Delete the last 7 days"],
];

const GUILD_SECTIONS = {};

function bindGuildSections(body, guild, open) {
  for (const details of $$("details[data-section]", body)) {
    let loaded = false;
    const load = () => {
      if (!details.open || loaded) return;
      loaded = true;
      GUILD_SECTIONS[details.dataset.section]?.($("[data-section-body]", details), guild);
    };
    details.addEventListener("toggle", load);
    if (details.dataset.section === open) {
      details.open = true;
      load();
    }
  }
}

function cursorSection(target, { label, placeholder, path, key, row, bind, empty, noMatch, more }) {
  const state = { q: "", next: null, items: [], generation: 0 };
  mount(
    target,
    html`
      ${label ? html`<label class="list-search">${label}<input type="search" data-search placeholder="${placeholder}" autocomplete="off" spellcheck="false" /></label>` : ""}
      <p class="muted list-status" data-status role="status" aria-live="polite">Loading…</p>
      <div class="resource-list" data-rows></div>
      <div class="form-actions" data-more-row hidden><button class="btn" type="button" data-more>${more}</button></div>
    `,
  );
  const rows = $("[data-rows]", target);
  const status = $("[data-status]", target);
  const search = $("[data-search]", target);
  const draw = (total) => {
    status.textContent = !state.items.length
      ? ""
      : total == null
        ? `${fmtNumber(state.items.length)}${state.next ? "+" : ""} ${state.items.length === 1 && !state.next ? "match" : "matches"}`
        : `${fmtNumber(state.items.length)} of ${fmtNumber(total)} shown`;
    $("[data-more-row]", target).hidden = !state.next;
    if (state.items.length) {
      mount(rows, state.items.map(row));
      bind(rows, state.items, reload);
      return;
    }
    const emptyState = state.q ? noMatch : empty;
    mount(
      rows,
      html`<div class="empty-state"><p class="muted">${emptyState.text}</p>${emptyState.action ? html`<button class="btn small" type="button" data-empty-action>${emptyState.action}</button>` : ""}</div>`,
    );
    $("[data-empty-action]", rows)?.addEventListener("click", () => {
      if (state.q) {
        search.value = "";
        state.q = "";
        reload();
        search.focus();
        return;
      }
      emptyState.run?.(target);
    });
  };
  const fetchPage = async (after) => {
    const generation = ++state.generation;
    const params = new URLSearchParams({ limit: "50" });
    if (state.q) params.set("q", state.q);
    if (after) params.set("after", after);
    status.textContent = "Loading…";
    try {
      const data = await api(`${path}?${params}`);
      if (generation !== state.generation || !target.isConnected) return;
      state.items = after ? [...state.items, ...data[key]] : data[key];
      state.next = data.next;
      draw(data.total);
    } catch (error) {
      if (generation !== state.generation || error.status === 499 || error.status === 401) return;
      status.textContent = error.message;
    }
  };
  const reload = () => fetchPage(null);
  search?.addEventListener(
    "input",
    debounce(() => {
      state.q = search.value.trim();
      reload();
    }),
  );
  $("[data-more]", target).addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const before = state.items.length;
    await fetchPage(state.next);
    button.disabled = false;
    $$("[data-row]", rows)[before]?.focus();
  });
  reload();
  return { reload };
}

const INVITE_AGES = [
  [1800, "30 minutes"],
  [3600, "1 hour"],
  [21600, "6 hours"],
  [43200, "12 hours"],
  [86400, "1 day"],
  [604800, "7 days"],
  [0, "Never"],
];
const INVITE_USES = [
  [0, "No limit"],
  [1, "1 use"],
  [5, "5 uses"],
  [10, "10 uses"],
  [25, "25 uses"],
  [50, "50 uses"],
  [100, "100 uses"],
];
const INVITE_CHANNEL_TYPES = new Set([0, 2, 5, 13, 15]);

const inviteState = (invite) => {
  if (invite.vanity) return "Vanity link";
  if (invite.expired) return "Expired";
  if (!invite.expires_at) return "Never expires";
  return `Expires ${fmtDate(invite.expires_at)}`;
};

GUILD_SECTIONS.invites = async (target, guild) => {
  mount(
    target,
    html`
      <form class="stack" data-invite-form>
        <div class="form-grid">
          <label>Channel<select name="channel_id" required><option value="">Loading channels…</option></select></label>
          <label>Expire after<select name="max_age">${options(INVITE_AGES, 604800)}</select></label>
          <label>Maximum uses<select name="max_uses">${options(INVITE_USES, 0)}</select></label>
        </div>
        <label class="toggle"><input type="checkbox" name="temporary" /><span>Remove people who joined with it when they go offline, unless they got a role</span></label>
        <div class="form-actions"><button class="btn primary" type="submit">Create invite</button></div>
      </form>
      <div class="stack" data-invite-list></div>
    `,
  );
  const form = $("[data-invite-form]", target);
  api(`/admin/guilds/${guild.id}/channels`)
    .then(({ channels }) => {
      const usable = channels.filter((channel) => INVITE_CHANNEL_TYPES.has(channel.type));
      mount(
        form.channel_id,
        usable.length
          ? usable.map((channel) => html`<option value="${channel.id}">${channel.type === 2 || channel.type === 13 ? "Voice: " : "#"}${channel.name}</option>`)
          : html`<option value="">No channel can take an invite</option>`,
      );
    })
    .catch((error) => mount(form.channel_id, html`<option value="">${error.message}</option>`));
  const list = cursorSection($("[data-invite-list]", target), {
    path: `/admin/guilds/${guild.id}/invites`,
    key: "invites",
    more: "Load more invites",
    empty: { text: "This server has no invites, so nobody new can join it except through a vanity link.", action: "Create invite", run: () => form.channel_id.focus() },
    noMatch: { text: "" },
    row: (invite) => html`<div class="resource-row ban-row" data-row tabindex="-1">
      <span class="ban-text">
        <strong>${invite.code}<span class="muted"> to ${invite.channel ? `#${invite.channel.name}` : "a deleted channel"}</span></strong>
        <span class="muted">${inviteState(invite)} · ${invite.max_uses ? `${fmtNumber(invite.uses)} of ${fmtNumber(invite.max_uses)} uses` : `${plural(invite.uses, "use")}`}${invite.inviter ? ` · Created by ${userName(invite.inviter)}` : ""}</span>
      </span>
      ${invite.vanity ? "" : html`<button class="btn small" type="button" data-revoke="${invite.code}" aria-label="Revoke invite ${invite.code}">Revoke invite</button>`}
    </div>`,
    bind: (rows, invites, reload) => {
      for (const button of $$("[data-revoke]", rows))
        button.addEventListener("click", async () => {
          const code = button.dataset.revoke;
          if (!(await confirmDialog({ title: `Revoke invite ${code}?`, message: "The link stops working right away. People who already joined stay.", confirm: "Revoke invite" }))) return;
          const done = await act(button, () => api(`/admin/guilds/${guild.id}/invites/${encodeURIComponent(code)}`, { method: "DELETE" }), `Invite ${code} was revoked`);
          if (done !== undefined) reload();
        });
    },
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.channel_id.value) {
      form.channel_id.setAttribute("aria-invalid", "true");
      form.channel_id.focus();
      return toast("Pick a channel for the invite", "error");
    }
    form.channel_id.removeAttribute("aria-invalid");
    const created = await act(
      $("button[type=submit]", form),
      () =>
        api(`/admin/guilds/${guild.id}/invites`, {
          method: "POST",
          body: {
            channel_id: form.channel_id.value,
            max_age: Number(form.max_age.value),
            max_uses: Number(form.max_uses.value),
            temporary: form.temporary.checked,
          },
        }),
    );
    if (!created) return;
    toast(`Invite ${created.code} was created`);
    list.reload();
  });
};

const memberName = (member) => member.nick || userName(member.user);
const timedOutUntil = (member) =>
  member.communication_disabled_until && new Date(member.communication_disabled_until).getTime() > Date.now() ? member.communication_disabled_until : null;

GUILD_SECTIONS.members = (target, guild) => {
  const rolesRequest = api(`/admin/guilds/${guild.id}/roles`).catch(() => ({ roles: [] }));
  cursorSection(target, {
    label: "Find members",
    placeholder: "Search names, nicknames or IDs",
    path: `/admin/guilds/${guild.id}/members`,
    key: "members",
    more: "Load more members",
    empty: { text: "This server has no members yet." },
    noMatch: { text: "No members match this search.", action: "Clear search" },
    row: (member) => html`<button class="resource-row" type="button" data-row data-member="${member.id}">
      ${avatar(member.user)}
      <strong>${memberName(member)}<span class="muted"> @${member.user.username}</span></strong>
      ${member.owner ? html`<span class="badge accent">Owner</span>` : ""}
      ${timedOutUntil(member) ? html`<span class="badge warn">Timed out</span>` : ""}
      ${member.protected ? html`<span class="badge">Staff above you</span>` : ""}
      <span class="muted">Manage</span>
    </button>`,
    bind: (rows, members, reload) => {
      for (const button of $$("[data-member]", rows))
        button.addEventListener("click", async () =>
          openAdminMember(guild, members.find((member) => member.id === button.dataset.member), (await rolesRequest).roles, reload),
        );
    },
  });
};

const openGuildSection = (from, name) => {
  const details = $(`details[data-section="${name}"]`, from.closest(".drawer-body") ?? document);
  if (!details) return;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  details.scrollIntoView({ block: "start" });
  $("[data-search]", details)?.focus();
};

GUILD_SECTIONS.bans = (target, guild) => {
  cursorSection(target, {
    label: "Find bans",
    placeholder: "Search names or IDs",
    path: `/admin/guilds/${guild.id}/bans`,
    key: "bans",
    more: "Load more bans",
    empty: { text: "Nobody is banned from this server. You can ban someone from their page under Members.", action: "Find a member", run: (from) => openGuildSection(from, "members") },
    noMatch: { text: "No bans match this search.", action: "Clear search" },
    row: (ban) => html`<div class="resource-row ban-row" data-row tabindex="-1">
      ${avatar(ban.user)}
      <span class="ban-text">
        <strong>${userName(ban.user)}${ban.user.username ? html`<span class="muted"> @${ban.user.username}</span>` : ""}</strong>
        <span class="muted">${ban.reason ? `Reason: ${ban.reason}` : "No reason given"}${ban.executor ? ` · Banned by ${userName(ban.executor)}` : ""}</span>
      </span>
      <button class="btn small" type="button" data-unban="${ban.user.id}" aria-label="Lift ban on ${userName(ban.user)}">Lift ban</button>
    </div>`,
    bind: (rows, bans, reload) => {
      for (const button of $$("[data-unban]", rows))
        button.addEventListener("click", async () => {
          const ban = bans.find((entry) => entry.user.id === button.dataset.unban);
          if (!(await confirmDialog({ title: `Lift the ban on ${userName(ban.user)}?`, message: `They can join ${guild.name} again with an invite.`, confirm: "Lift ban", danger: false }))) return;
          const done = await act(button, () => api(`/admin/guilds/${guild.id}/bans/${ban.user.id}`, { method: "DELETE" }), `${userName(ban.user)} can join again`);
          if (done !== undefined) reload();
        });
    },
  });
};

function openAdminMember(guild, member, roles) {
  const until = timedOutUntil(member);
  const assignable = roles.filter((role) => role.id !== guild.id);
  const locked = member.protected;
  const body = openDrawer(
    `Manage ${memberName(member)}`,
    html`
      <div class="ident">
        ${avatar(member.user, "large")}
        <div>
          <h2>${memberName(member)}</h2>
          <span class="muted">@${member.user.username} in ${guild.name}</span>
        </div>
      </div>
      ${locked ? html`<p class="notice">This account is staff at or above your level, so you can't change its membership.</p>` : ""}
      <div class="card">
        <div class="list">
          <div class="list-item"><span class="grow muted">Joined</span><span>${fmtDate(member.joined_at)}</span></div>
          <div class="list-item"><span class="grow muted">User ID</span><code>${member.user.id}</code></div>
          ${member.owner ? html`<div class="list-item"><span class="grow muted">Role</span><span>Server owner</span></div>` : ""}
        </div>
        ${state.overview.access.users ? html`<div class="form-actions"><button class="btn" type="button" data-open-account>Open account</button></div>` : ""}
      </div>
      <form class="card stack" id="member-form">
        <h3>Nickname and roles</h3>
        <label>Nickname<span class="hint">Up to 32 characters. Leave empty to show their display name.</span><input name="nick" maxlength="32" value="${member.nick ?? ""}" autocomplete="off" /></label>
        <fieldset class="stack">
          <legend>Roles</legend>
          ${
            assignable.length
              ? html`<div class="checks">${assignable.map(
                  (role) =>
                    html`<label class="toggle"><input type="checkbox" data-role="${role.id}" ${member.roles.includes(role.id) ? raw("checked") : ""} ${role.managed ? raw("disabled") : ""} /><span>${role.name}${role.managed ? " (managed by an integration)" : ""}</span></label>`,
                )}</div>`
              : html`<p class="muted">This server has no roles besides everyone. Create one under Manage channels and roles.</p>`
          }
        </fieldset>
        <div class="form-actions"><button class="btn primary" type="submit" ${locked ? raw("disabled") : ""}>Save member</button></div>
      </form>
      <form class="card stack" id="member-timeout">
        <h3>Timeout</h3>
        ${
          until
            ? html`<p class="muted">Timed out until ${fmtDate(until)}. They can read the server but can't send messages, react or join voice.</p>`
            : html`<p class="muted">A timed out member can read the server but can't send messages, react or join voice.</p>
                <label>Length<select name="seconds">${options(TIMEOUT_CHOICES, 3600)}</select></label>`
        }
        <label>Reason<span class="hint">Saved in the server's audit log.</span><input name="reason" maxlength="512" autocomplete="off" /></label>
        <div class="form-actions">
          <button class="btn ${until ? "" : "primary"}" type="submit" ${locked || member.owner ? raw("disabled") : ""}>${until ? "End timeout" : "Time out member"}</button>
        </div>
      </form>
      <form class="card danger-zone stack" id="member-remove">
        <h3>Remove or ban</h3>
        <p class="muted">Removing someone lets them join again with an invite. Banning removes them and keeps them out.</p>
        <label>Reason<span class="hint">Saved in the server's audit log.</span><input name="reason" maxlength="512" autocomplete="off" /></label>
        <label>Messages when banning<select name="delete">${options(BAN_DELETE_CHOICES, 0)}</select></label>
        <div class="form-actions">
          <button class="btn danger" type="button" data-kick ${locked || member.owner ? raw("disabled") : ""}>Remove from server</button>
          <button class="btn danger" type="button" data-ban ${locked || member.owner ? raw("disabled") : ""}>Ban from server</button>
        </div>
        ${member.owner ? html`<p class="muted">Transfer the server to someone else before removing or banning its owner.</p>` : ""}
      </form>
      <div class="form-actions"><button class="btn" type="button" data-return-server>Back to server</button></div>
    `,
  );
  if (!body) return;
  const back = () => openGuild(guild.id, undefined, "members");
  $("[data-return-server]", body).addEventListener("click", back);
  $("[data-open-account]", body)?.addEventListener("click", () => openUser(member.user.id));
  $("#member-form", body).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const saved = await act(
      $("button[type=submit]", form),
      () =>
        api(`/admin/guilds/${guild.id}/members/${member.id}`, {
          method: "PATCH",
          body: {
            nick: form.nick.value.trim() || null,
            roles: $$("[data-role]", form)
              .filter((box) => box.checked)
              .map((box) => box.dataset.role),
          },
        }),
      "Member saved",
    );
    if (saved) back();
  });
  $("#member-timeout", body).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const end = until ? null : new Date(Date.now() + Number(form.seconds.value) * 1000).toISOString();
    const saved = await act(
      $("button[type=submit]", form),
      () =>
        api(`/admin/guilds/${guild.id}/members/${member.id}`, {
          method: "PATCH",
          body: { communication_disabled_until: end },
          reason: form.reason.value.trim(),
        }),
      until ? "Timeout ended" : `${memberName(member)} is timed out`,
    );
    if (saved) back();
  });
  const removal = $("#member-remove", body);
  $("[data-kick]", removal).addEventListener("click", async (event) => {
    if (!(await confirmDialog({ title: `Remove ${memberName(member)} from ${guild.name}?`, message: "They can join again with an invite.", confirm: "Remove member" }))) return;
    const done = await act(
      event.currentTarget,
      () => api(`/admin/guilds/${guild.id}/members/${member.id}`, { method: "DELETE", reason: removal.reason.value.trim() }),
      `${memberName(member)} was removed`,
    );
    if (done !== undefined) back();
  });
  $("[data-ban]", removal).addEventListener("click", async (event) => {
    const seconds = Number(removal.delete.value);
    if (
      !(await confirmDialog({
        title: `Ban ${memberName(member)} from ${guild.name}?`,
        message: `They're removed and can't join again until the ban is lifted.${seconds ? " Their recent messages in this server are deleted." : ""}`,
        confirm: "Ban member",
      }))
    )
      return;
    const reason = removal.reason.value.trim();
    const done = await act(
      event.currentTarget,
      () =>
        api(`/admin/guilds/${guild.id}/bans/${member.id}`, {
          method: "PUT",
          body: { delete_message_seconds: seconds, ...(reason ? { reason } : {}) },
        }),
      `${memberName(member)} was banned`,
    );
    if (done !== undefined) back();
  });
}

const EXPRESSION_KINDS = {
  emoji: {
    path: "emojis",
    key: "emojis",
    one: "emoji",
    deleteNote: "Removes it from the server and deletes its image. Messages that used it show its name instead.",
    title: "Emoji",
    empty: "This server has no custom emoji. Members who can manage expressions upload them in the server's settings in the app.",
    preview: (item) => html`<img class="emoji-thumb" src="/emojis/${item.id}.${item.animated ? "gif" : "png"}?size=48" alt="" loading="lazy" />`,
    label: (item) => `:${item.name}:`,
    detail: (item) => (item.managed ? "Managed by an integration" : item.uploader ? `Uploaded by ${userName(item.uploader)}` : "Uploader unknown"),
    fields: (item) => html`<label>Name<span class="hint">2 to 32 letters, numbers or underscores.</span><input name="name" value="${item.name}" minlength="2" maxlength="32" pattern="[A-Za-z0-9_]+" required autocomplete="off" spellcheck="false" /></label>`,
    patch: (form) => ({ name: form.name.value.trim() }),
  },
  sticker: {
    path: "stickers",
    key: "stickers",
    one: "sticker",
    deleteNote: "Removes it from the server and deletes its image. Messages that used it show a missing sticker.",
    title: "Stickers",
    empty: "This server has no stickers. Members who can manage expressions upload them in the server's settings in the app.",
    preview: (item) => stickerThumb(item, "small"),
    label: (item) => item.name,
    detail: (item) => item.description || "No description",
    fields: (item) => html`<label>Name<span class="hint">2 to 30 characters.</span><input name="name" value="${item.name}" minlength="2" maxlength="30" required autocomplete="off" /></label>
      <label>Description<span class="hint">Up to 100 characters.</span><input name="description" value="${item.description ?? ""}" maxlength="100" autocomplete="off" /></label>
      <label>Related emoji or words<span class="hint">Up to 200 characters. The client suggests the sticker when someone types them.</span><input name="tags" value="${item.tags}" maxlength="200" required autocomplete="off" /></label>`,
    patch: (form) => ({ name: form.name.value.trim(), description: form.description.value.trim() || null, tags: form.tags.value.trim() }),
  },
  sound: {
    path: "soundboard-sounds",
    key: "sounds",
    one: "sound",
    deleteNote: "Removes it from everyone's soundboard and deletes its audio.",
    title: "Soundboard sounds",
    empty: "This server has no soundboard sounds. Members who can manage expressions upload them in the server's settings in the app.",
    preview: (item) => html`<span class="sticker-thumb small" aria-hidden="true">${item.emoji_name || "♪"}</span>`,
    label: (item) => item.name,
    detail: (item) => `Volume ${Math.round(item.volume * 100)}%${item.uploader ? ` · Uploaded by ${userName(item.uploader)}` : ""}`,
    fields: (item) => html`<audio controls preload="none" src="${item.url}"></audio>
      <label>Name<span class="hint">2 to 32 characters.</span><input name="name" value="${item.name}" minlength="2" maxlength="32" required autocomplete="off" /></label>
      <label>Volume<span class="hint">How loud it plays, from 0 to 100 percent.</span><input name="volume" type="number" inputmode="numeric" min="0" max="100" step="1" value="${Math.round(item.volume * 100)}" required /></label>
      <label>Emoji<span class="hint">One emoji shown next to the sound. Leave empty for none.</span><input name="emoji_name" value="${item.emoji_id ? "" : (item.emoji_name ?? "")}" maxlength="32" autocomplete="off" /></label>`,
    patch: (form) => ({ name: form.name.value.trim(), volume: Number(form.volume.value) / 100, emoji_name: form.emoji_name.value.trim() || null }),
  },
};

GUILD_SECTIONS.expressions = (target, guild) => {
  mount(
    target,
    html`${Object.entries(EXPRESSION_KINDS).map(
      ([kind, spec]) => html`<div class="stack" data-expression-kind="${kind}"><h4>${spec.title}</h4><div class="spinner">Loading…</div></div>`,
    )}`,
  );
  for (const [kind, spec] of Object.entries(EXPRESSION_KINDS)) {
    const box = $(`[data-expression-kind="${kind}"]`, target);
    api(`/admin/guilds/${guild.id}/${spec.path}`)
      .then((data) => {
        const items = data[spec.key];
        mount(
          box,
          html`<h4>${spec.title}<span class="muted"> ${fmtNumber(items.length)}${data.truncated ? "+" : ""}</span></h4>
            ${
              items.length
                ? html`<div class="resource-list">${items.map(
                    (item) => html`<button class="resource-row" type="button" data-expression="${item.id}" ${item.managed ? raw("disabled") : ""}>
                      ${spec.preview(item)}
                      <span class="ban-text"><strong>${spec.label(item)}</strong><span class="muted">${spec.detail(item)}</span></span>
                      <span class="muted">${item.managed ? "Read only" : "Edit"}</span>
                    </button>`,
                  )}</div>`
                : html`<div class="empty-state"><p class="muted">${spec.empty}</p><a class="btn small" href="/channels/${guild.id}">Open the server in the app</a></div>`
            }`,
        );
        watchStickerThumbs(box);
        for (const button of $$("[data-expression]", box))
          button.addEventListener("click", () => openAdminExpression(guild, kind, items.find((item) => item.id === button.dataset.expression)));
      })
      .catch((error) => {
        if (error.status !== 499) mount(box, html`<p class="form-error">${error.message}</p>`);
      });
  }
};

function openAdminExpression(guild, kind, item) {
  const spec = EXPRESSION_KINDS[kind];
  const body = openDrawer(
    `Edit ${spec.label(item)}`,
    html`
      <div class="ident">${spec.preview(item)}<div><h2>${spec.label(item)}</h2><span class="muted">${spec.one[0].toUpperCase()}${spec.one.slice(1)} in ${guild.name}</span></div></div>
      <form class="card stack" id="expression-form">
        ${spec.fields(item)}
        <div class="form-actions"><button class="btn primary" type="submit">Save ${spec.one}</button></div>
      </form>
      <div class="card danger-zone stack">
        <h3>Delete ${spec.one}</h3>
        <p class="muted">${spec.deleteNote}</p>
        <div><button class="btn danger" type="button" data-delete>Delete ${spec.one}</button></div>
      </div>
      <div class="form-actions"><button class="btn" type="button" data-return-server>Back to server</button></div>
    `,
  );
  if (!body) return;
  watchStickerThumbs(body);
  const back = () => openGuild(guild.id, undefined, "expressions");
  $("[data-return-server]", body).addEventListener("click", back);
  $("#expression-form", body).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const saved = await act(
      $("button[type=submit]", form),
      () => api(`/admin/guilds/${guild.id}/${spec.path}/${item.id}`, { method: "PATCH", body: spec.patch(form) }),
      `${spec.label(item)} was saved`,
    );
    if (saved) back();
  });
  $("[data-delete]", body).addEventListener("click", async (event) => {
    if (!(await confirmDialog({ title: `Delete ${spec.label(item)}?`, message: `It's removed from ${guild.name} for everyone. This can't be undone.`, confirm: `Delete ${spec.one}` }))) return;
    const done = await act(event.currentTarget, () => api(`/admin/guilds/${guild.id}/${spec.path}/${item.id}`, { method: "DELETE" }), `${spec.label(item)} was deleted`);
    if (done !== undefined) back();
  });
}
