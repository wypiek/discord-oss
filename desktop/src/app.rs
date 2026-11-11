use crate::api::{Api, ApiError, LoginOutcome};
use crate::discovery::{self, Instance};
use crate::gateway::{self, GatewayEvent};
use crate::model::{channel_type, Channel, Guild, GuildDelete, Member, Message, MessageDelete, Ready, Role, RoleEvent, User};
use crate::store::Store;
use crate::{images, permissions, secrets, text};
use crate::{AppWindow, AttachmentRow, ChannelRow, GuildRow, InstanceRow, MessageRow};
use serde_json::Value;
use slint::{ComponentHandle, Image, ModelRc, Rgba8Pixel, SharedPixelBuffer, VecModel, Weak};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

pub const APP_NAME: &str = "OSS Chat";
const DIRECT_MESSAGES: &str = "@me";
const PAGE_SIZE: usize = 50;
const GROUP_WINDOW_SECONDS: i64 = 7 * 60;
const ENCRYPTED_NOTICE: &str = "Encrypted message. Open this conversation in the browser to read it.";

const PICKER: i32 = 0;
const LOGIN: i32 = 1;
const MAIN: i32 = 2;
const CONNECTING: i32 = 3;

struct Login {
    instance: Instance,
    ticket: Option<String>,
    busy: bool,
    error: String,
}

struct Session {
    generation: u64,
    instance: Instance,
    api: Api,
    me: User,
    ready: bool,
    guilds: Vec<Guild>,
    member_roles: HashMap<String, Vec<String>>,
    dms: Vec<Channel>,
    users: HashMap<String, User>,
    selected_guild: String,
    selected_channel: Option<String>,
    messages: Vec<Message>,
    has_older: bool,
    loading: bool,
    status: String,
    gateway: Option<JoinHandle<()>>,
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(gateway) = self.gateway.take() {
            gateway.abort();
        }
    }
}

#[derive(Default)]
struct State {
    store: Store,
    store_path: PathBuf,
    screen: i32,
    preview: Option<Instance>,
    picker_error: String,
    looking_up: bool,
    login: Option<Login>,
    session: Option<Session>,
    generation: u64,
    connecting_text: String,
    images: HashMap<String, Option<SharedPixelBuffer<Rgba8Pixel>>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ListedChannel {
    pub id: String,
    pub name: String,
    pub prefix: &'static str,
    pub is_category: bool,
    pub enabled: bool,
}

fn snowflake(id: &str) -> u64 {
    id.parse().unwrap_or(0)
}

fn prefix(channel: &Channel) -> &'static str {
    match channel.kind {
        channel_type::GUILD_TEXT | channel_type::GUILD_ANNOUNCEMENT => "#",
        channel_type::GUILD_VOICE | channel_type::GUILD_STAGE_VOICE => "•",
        channel_type::GUILD_FORUM | channel_type::GUILD_MEDIA => "≡",
        channel_type::DM | channel_type::GROUP_DM => "@",
        _ => "#",
    }
}

fn is_voice(channel: &Channel) -> bool {
    matches!(channel.kind, channel_type::GUILD_VOICE | channel_type::GUILD_STAGE_VOICE)
}

fn is_listed(channel: &Channel) -> bool {
    !matches!(channel.kind, 10..=12)
}

pub fn guild_channels(guild: &Guild, me: &str, roles: &[String]) -> Vec<ListedChannel> {
    let viewable = |channel: &Channel| permissions::can(permissions::in_channel(guild, me, roles, channel), permissions::VIEW_CHANNEL);
    let listed = |channel: &Channel| ListedChannel {
        id: channel.id.clone(),
        name: channel.name.clone().unwrap_or_default(),
        prefix: prefix(channel),
        is_category: channel.kind == channel_type::GUILD_CATEGORY,
        enabled: channel.is_text(),
    };
    let sort = |channels: &mut Vec<&Channel>| channels.sort_by_key(|channel| (is_voice(channel), channel.position, snowflake(&channel.id)));
    let mut top: Vec<&Channel> = guild
        .channels
        .iter()
        .filter(|channel| is_listed(channel) && channel.kind != channel_type::GUILD_CATEGORY && channel.parent_id.is_none() && viewable(channel))
        .collect();
    sort(&mut top);
    let mut categories: Vec<&Channel> = guild.channels.iter().filter(|channel| channel.kind == channel_type::GUILD_CATEGORY).collect();
    categories.sort_by_key(|channel| (channel.position, snowflake(&channel.id)));
    let mut rows: Vec<ListedChannel> = top.into_iter().map(listed).collect();
    for category in categories {
        let mut children: Vec<&Channel> = guild
            .channels
            .iter()
            .filter(|channel| is_listed(channel) && channel.parent_id.as_deref() == Some(category.id.as_str()) && viewable(channel))
            .collect();
        if children.is_empty() && !viewable(category) {
            continue;
        }
        sort(&mut children);
        let mut heading = listed(category);
        heading.name = heading.name.to_uppercase();
        rows.push(heading);
        rows.extend(children.into_iter().map(listed));
    }
    rows
}

fn system_text(message: &Message) -> String {
    let author = message.author.display_name();
    match message.kind {
        1 => format!("{author} added someone to the group."),
        2 => format!("{author} removed someone from the group."),
        3 => format!("{author} started a call."),
        4 => format!("{author} changed the channel name."),
        5 => format!("{author} changed the channel icon."),
        6 => format!("{author} pinned a message."),
        7 => format!("{author} joined the server."),
        8..=11 => format!("{author} boosted the server."),
        18 => format!("{author} started a thread."),
        67 => "You're now friends.".into(),
        _ => format!("{author} did something this app can't show yet."),
    }
}

fn is_normal(message: &Message) -> bool {
    matches!(message.kind, 0 | 19 | 20 | 23)
}

pub fn groups_with_previous(previous: Option<&Message>, message: &Message) -> bool {
    let Some(previous) = previous else {
        return false;
    };
    if previous.author.id != message.author.id || !is_normal(previous) || !is_normal(message) || message.kind == 19 {
        return false;
    }
    match (text::parse_time(&previous.timestamp), text::parse_time(&message.timestamp)) {
        (Some(a), Some(b)) => (b - a).num_seconds().abs() < GROUP_WINDOW_SECONDS,
        _ => false,
    }
}

fn merge_message(target: &mut Message, patch: &Value) {
    if let Some(content) = patch.get("content").and_then(Value::as_str) {
        target.content = content.to_string();
    }
    if let Some(edited) = patch.get("edited_timestamp").and_then(Value::as_str) {
        target.edited_timestamp = Some(edited.to_string());
    }
    if let Some(attachments) = patch.get("attachments").and_then(|value| serde_json::from_value(value.clone()).ok()) {
        target.attachments = attachments;
    }
    if let Some(encrypted) = patch.get("encrypted") {
        target.encrypted = Some(encrypted.clone()).filter(|value| !value.is_null());
    }
}

fn sorted_dms(dms: &mut [Channel]) {
    dms.sort_by_key(|channel| std::cmp::Reverse(snowflake(channel.last_message_id.as_deref().unwrap_or(&channel.id))));
}

fn rows<T: Clone + 'static>(items: Vec<T>) -> ModelRc<T> {
    ModelRc::new(VecModel::from(items))
}

#[derive(Clone)]
pub struct App {
    ui: Weak<AppWindow>,
    runtime: Handle,
    state: Arc<Mutex<State>>,
}

impl App {
    pub fn start(ui: &AppWindow, runtime: Handle) -> Self {
        let store_path = dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("oss-chat").join("instances.json");
        let store = Store::load(&store_path);
        let app = App {
            ui: ui.as_weak(),
            runtime,
            state: Arc::new(Mutex::new(State {
                store,
                store_path,
                ..Default::default()
            })),
        };
        app.bind(ui);
        {
            let mut state = app.state.lock().unwrap();
            let last = state.store.last_instance().cloned();
            match last.and_then(|instance| secrets::load(&instance.id).map(|token| (instance, token))) {
                Some((instance, token)) => app.connect(&mut state, instance, token),
                None => state.screen = PICKER,
            }
            app.render(ui, &mut state);
        }
        app
    }

    fn later(&self, f: impl FnOnce(&App, &AppWindow, &mut State) + Send + 'static) {
        let app = self.clone();
        let _ = self.ui.upgrade_in_event_loop(move |ui| {
            let mut state = app.state.lock().unwrap();
            f(&app, &ui, &mut state);
        });
    }

    fn now(&self, f: impl FnOnce(&App, &AppWindow, &mut State)) {
        if let Some(ui) = self.ui.upgrade() {
            let mut state = self.state.lock().unwrap();
            f(self, &ui, &mut state);
        }
    }

    fn bind(&self, ui: &AppWindow) {
        let app = self.clone();
        ui.on_look_up(move |address| app.now(|app, ui, state| app.look_up(ui, state, address.to_string())));
        let app = self.clone();
        ui.on_add_previewed(move || {
            app.now(|app, ui, state| {
                let Some(instance) = state.preview.take() else { return };
                state.store.upsert(instance.clone());
                if let Err(error) = state.store.save(&state.store_path) {
                    state.picker_error = format!("Couldn't save the instance list: {error}");
                }
                app.open_instance(ui, state, &instance.id);
            })
        });
        let app = self.clone();
        ui.on_cancel_preview(move || {
            app.now(|app, ui, state| {
                state.preview = None;
                app.render(ui, state);
            })
        });
        let app = self.clone();
        ui.on_open_instance(move |id| app.now(|app, ui, state| app.open_instance(ui, state, &id)));
        let app = self.clone();
        ui.on_remove_instance(move |id| {
            app.now(|app, ui, state| {
                state.store.remove(&id);
                let _ = state.store.save(&state.store_path);
                secrets::forget(&id);
                app.render(ui, state);
            })
        });
        let app = self.clone();
        ui.on_log_in(move |login, password| app.now(|app, ui, state| app.log_in(ui, state, login.to_string(), password.to_string())));
        let app = self.clone();
        ui.on_submit_code(move |code| app.now(|app, ui, state| app.submit_code(ui, state, code.to_string())));
        let app = self.clone();
        ui.on_create_account(move || {
            app.now(|_, _, state| {
                if let Some(login) = &state.login {
                    let _ = open::that_detached(login.instance.page("/register"));
                }
            })
        });
        let app = self.clone();
        ui.on_back_to_instances(move || app.now(|app, ui, state| app.show_picker(ui, state)));
        let app = self.clone();
        ui.on_switch_instance(move || app.now(|app, ui, state| app.show_picker(ui, state)));
        let app = self.clone();
        ui.on_log_out(move || app.now(|app, ui, state| app.log_out(ui, state)));
        let app = self.clone();
        ui.on_select_guild(move |id| app.now(|app, ui, state| app.select_guild(ui, state, id.to_string())));
        let app = self.clone();
        ui.on_select_channel(move |id| app.now(|app, ui, state| app.select_channel(ui, state, id.to_string())));
        let app = self.clone();
        ui.on_send_message(move |content| app.now(|app, ui, state| app.send_message(ui, state, content.to_string())));
        let app = self.clone();
        ui.on_load_older(move || app.now(|app, ui, state| app.load_older(ui, state)));
        ui.on_open_url(|url| {
            if url.starts_with("https://") || url.starts_with("http://") {
                let _ = open::that_detached(url.as_str());
            }
        });
        let app = self.clone();
        ui.on_open_in_browser(move || {
            app.now(|_, _, state| {
                if let Some(session) = &state.session {
                    let channel = session.selected_channel.clone().unwrap_or_default();
                    let _ = open::that_detached(session.instance.page(&format!("/channels/{}/{channel}", session.selected_guild)));
                }
            })
        });
    }

    fn look_up(&self, ui: &AppWindow, state: &mut State, address: String) {
        state.looking_up = true;
        state.picker_error.clear();
        state.preview = None;
        self.render(ui, state);
        let app = self.clone();
        self.runtime.spawn(async move {
            let result = discovery::discover(&address).await;
            app.later(move |app, ui, state| {
                state.looking_up = false;
                match result {
                    Ok(instance) => state.preview = Some(instance),
                    Err(error) => state.picker_error = error,
                }
                app.render(ui, state);
            });
        });
    }

    fn show_picker(&self, ui: &AppWindow, state: &mut State) {
        state.session = None;
        state.login = None;
        state.screen = PICKER;
        self.render(ui, state);
    }

    fn show_login(&self, ui: &AppWindow, state: &mut State, instance: Instance, error: String) {
        state.session = None;
        state.login = Some(Login {
            instance,
            ticket: None,
            busy: false,
            error,
        });
        state.screen = LOGIN;
        self.render(ui, state);
    }

    fn open_instance(&self, ui: &AppWindow, state: &mut State, id: &str) {
        let Some(instance) = state.store.get(id).cloned() else { return };
        state.store.last = Some(instance.id.clone());
        let _ = state.store.save(&state.store_path);
        match secrets::load(&instance.id) {
            Some(token) => {
                self.connect(state, instance, token);
                self.render(ui, state);
            }
            None => self.show_login(ui, state, instance, String::new()),
        }
    }

    fn log_in(&self, ui: &AppWindow, state: &mut State, login: String, password: String) {
        let Some(current) = state.login.as_mut() else { return };
        current.busy = true;
        current.error.clear();
        let instance = current.instance.clone();
        self.render(ui, state);
        let app = self.clone();
        self.runtime.spawn(async move {
            let result = match Api::new(&instance, None) {
                Ok(api) => api.login(&login, &password).await,
                Err(error) => Err(ApiError::Message(error)),
            };
            app.later(move |app, ui, state| {
                let Some(current) = state.login.as_mut() else { return };
                current.busy = false;
                match result {
                    Ok(LoginOutcome::Token(token)) => return app.finish_login(ui, state, token),
                    Ok(LoginOutcome::SecondFactor { ticket }) => current.ticket = Some(ticket),
                    Ok(LoginOutcome::Captcha) => {
                        current.error = "This instance asks for a captcha when you log in, which the app can't show yet. Log in on the website instead.".into()
                    }
                    Err(error) => current.error = error.to_string(),
                }
                app.render(ui, state);
            });
        });
    }

    fn submit_code(&self, ui: &AppWindow, state: &mut State, code: String) {
        let Some(current) = state.login.as_mut() else { return };
        let Some(ticket) = current.ticket.clone() else { return };
        current.busy = true;
        current.error.clear();
        let instance = current.instance.clone();
        self.render(ui, state);
        let app = self.clone();
        self.runtime.spawn(async move {
            let result = match Api::new(&instance, None) {
                Ok(api) => api.second_factor(&ticket, &code).await,
                Err(error) => Err(ApiError::Message(error)),
            };
            app.later(move |app, ui, state| {
                let Some(current) = state.login.as_mut() else { return };
                current.busy = false;
                match result {
                    Ok(token) => return app.finish_login(ui, state, token),
                    Err(error) => current.error = error.to_string(),
                }
                app.render(ui, state);
            });
        });
    }

    fn finish_login(&self, ui: &AppWindow, state: &mut State, token: String) {
        let Some(login) = state.login.take() else { return };
        if let Err(error) = secrets::save(&login.instance.id, &token) {
            eprintln!("couldn't save the login in the system keychain: {error}");
        }
        self.connect(state, login.instance, token);
        self.render(ui, state);
    }

    fn connect(&self, state: &mut State, instance: Instance, token: String) {
        state.session = None;
        let api = match Api::new(&instance, Some(token.clone())) {
            Ok(api) => api,
            Err(error) => {
                state.login = Some(Login {
                    instance,
                    ticket: None,
                    busy: false,
                    error,
                });
                state.screen = LOGIN;
                return;
            }
        };
        state.generation += 1;
        let generation = state.generation;
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let gateway = gateway::spawn(&self.runtime, instance.gateway(), token, APP_NAME.into(), sender);
        let app = self.clone();
        self.runtime.spawn(async move {
            while let Some(event) = receiver.recv().await {
                app.later(move |app, ui, state| app.on_gateway(ui, state, generation, event));
            }
        });
        state.connecting_text = format!("Connecting to {}…", instance.name);
        state.screen = CONNECTING;
        state.session = Some(Session {
            generation,
            instance,
            api,
            me: User::default(),
            ready: false,
            guilds: Vec::new(),
            member_roles: HashMap::new(),
            dms: Vec::new(),
            users: HashMap::new(),
            selected_guild: DIRECT_MESSAGES.into(),
            selected_channel: None,
            messages: Vec::new(),
            has_older: false,
            loading: false,
            status: String::new(),
            gateway: Some(gateway),
        });
    }

    fn session_ended(&self, ui: &AppWindow, state: &mut State, message: &str) {
        if let Some(session) = state.session.take() {
            secrets::forget(&session.instance.id);
            let instance = session.instance.clone();
            drop(session);
            self.show_login(ui, state, instance, message.into());
        }
    }

    fn log_out(&self, ui: &AppWindow, state: &mut State) {
        let Some(session) = state.session.take() else { return };
        secrets::forget(&session.instance.id);
        let api = session.api.clone();
        let instance = session.instance.clone();
        drop(session);
        self.runtime.spawn(async move { api.logout().await });
        self.show_login(ui, state, instance, String::new());
    }

    fn on_gateway(&self, ui: &AppWindow, state: &mut State, generation: u64, event: GatewayEvent) {
        let Some(session) = state.session.as_mut().filter(|session| session.generation == generation) else {
            return;
        };
        match event {
            GatewayEvent::Connecting => {
                if session.ready {
                    session.status = "Reconnecting…".into();
                }
            }
            GatewayEvent::Reconnecting(seconds) => {
                session.status = format!("Lost the connection. Trying again in {seconds} s…");
                state.connecting_text = format!("Couldn't connect to {}. Trying again in {seconds} s…", session.instance.name);
            }
            GatewayEvent::AuthFailed => return self.session_ended(ui, state, "Your session has ended. Log in again."),
            GatewayEvent::Dispatch(name, data) => {
                if !self.dispatch(state, &name, data) {
                    return;
                }
            }
        }
        self.render(ui, state);
    }

    fn dispatch(&self, state: &mut State, name: &str, data: Value) -> bool {
        let Some(session) = state.session.as_mut() else { return false };
        match name {
            "READY" => {
                let Ok(ready) = serde_json::from_value::<Ready>(data) else {
                    session.status = "The instance sent a session the app didn't understand.".into();
                    return true;
                };
                session.member_roles = ready
                    .guilds
                    .iter()
                    .zip(ready.merged_members.iter())
                    .map(|(guild, members)| (guild.id.clone(), members.first().map(|member| member.roles.clone()).unwrap_or_default()))
                    .collect();
                session.users.clear();
                for user in ready.users.iter().chain(ready.private_channels.iter().flat_map(|channel| channel.recipients.iter())) {
                    session.users.insert(user.id.clone(), user.clone());
                }
                session.users.insert(ready.user.id.clone(), ready.user.clone());
                session.me = ready.user;
                session.guilds = ready.guilds.into_iter().filter(|guild| guild.unavailable != Some(true)).collect();
                session.dms = ready.private_channels;
                sorted_dms(&mut session.dms);
                session.ready = true;
                session.status.clear();
                state.screen = MAIN;
                let keeps_guild = session.selected_guild == DIRECT_MESSAGES || session.guilds.iter().any(|guild| guild.id == session.selected_guild);
                if !keeps_guild {
                    session.selected_guild = DIRECT_MESSAGES.into();
                }
                if session.selected_guild == DIRECT_MESSAGES && session.selected_channel.is_none() {
                    if let Some(first) = session.guilds.first() {
                        session.selected_guild = first.id.clone();
                    }
                }
                let channel = session
                    .selected_channel
                    .clone()
                    .filter(|id| self.channel_selectable(session, id))
                    .or_else(|| self.default_channel(session));
                session.selected_channel = channel;
                self.load_messages(state, None);
            }
            "GUILD_CREATE" => {
                let roles = data
                    .get("members")
                    .and_then(|members| serde_json::from_value::<Vec<Member>>(members.clone()).ok())
                    .and_then(|members| members.into_iter().find(|member| member.user.as_ref().is_some_and(|user| user.id == session.me.id)))
                    .map(|member| member.roles);
                let Ok(guild) = serde_json::from_value::<Guild>(data) else { return false };
                if let Some(roles) = roles {
                    session.member_roles.insert(guild.id.clone(), roles);
                }
                match session.guilds.iter_mut().find(|existing| existing.id == guild.id) {
                    Some(existing) => *existing = guild,
                    None => session.guilds.push(guild),
                }
            }
            "GUILD_UPDATE" => {
                let Ok(update) = serde_json::from_value::<Guild>(data) else { return false };
                let Some(guild) = session.guilds.iter_mut().find(|guild| guild.id == update.id) else {
                    return false;
                };
                guild.name = update.name;
                guild.icon = update.icon;
                guild.owner_id = update.owner_id;
                if !update.roles.is_empty() {
                    guild.roles = update.roles;
                }
            }
            "GUILD_DELETE" => {
                let Ok(deleted) = serde_json::from_value::<GuildDelete>(data) else { return false };
                session.guilds.retain(|guild| guild.id != deleted.id);
                if session.selected_guild == deleted.id {
                    session.selected_guild = DIRECT_MESSAGES.into();
                    session.selected_channel = self.default_channel(session);
                    self.load_messages(state, None);
                }
            }
            "CHANNEL_CREATE" | "CHANNEL_UPDATE" | "CHANNEL_DELETE" => {
                let Ok(channel) = serde_json::from_value::<Channel>(data) else { return false };
                let deleting = name == "CHANNEL_DELETE";
                let list = match channel.guild_id.clone() {
                    Some(guild_id) => match session.guilds.iter_mut().find(|guild| guild.id == guild_id) {
                        Some(guild) => &mut guild.channels,
                        None => return false,
                    },
                    None if channel.is_private() => &mut session.dms,
                    None => return false,
                };
                list.retain(|existing| existing.id != channel.id);
                if channel.is_private() {
                    for user in &channel.recipients {
                        session.users.insert(user.id.clone(), user.clone());
                    }
                }
                let id = channel.id.clone();
                if !deleting {
                    list.push(channel);
                }
                sorted_dms(&mut session.dms);
                if session.selected_channel.as_deref() == Some(id.as_str()) && !self.channel_selectable(session, &id) {
                    session.selected_channel = self.default_channel(session);
                    self.load_messages(state, None);
                }
            }
            "GUILD_ROLE_CREATE" | "GUILD_ROLE_UPDATE" | "GUILD_ROLE_DELETE" => {
                let Ok(event) = serde_json::from_value::<RoleEvent>(data) else { return false };
                let Some(guild) = session.guilds.iter_mut().find(|guild| guild.id == event.guild_id) else {
                    return false;
                };
                let removed = event.role_id.or_else(|| event.role.as_ref().map(|role| role.id.clone()));
                guild.roles.retain(|role| Some(&role.id) != removed.as_ref());
                if name != "GUILD_ROLE_DELETE" {
                    guild.roles.extend(event.role.into_iter().collect::<Vec<Role>>());
                }
            }
            "GUILD_MEMBER_UPDATE" => {
                let Ok(member) = serde_json::from_value::<Member>(data) else { return false };
                let (Some(user), Some(guild_id)) = (member.user, member.guild_id) else { return false };
                if user.id != session.me.id {
                    return false;
                }
                session.member_roles.insert(guild_id, member.roles);
            }
            "USER_UPDATE" => {
                let Ok(user) = serde_json::from_value::<User>(data) else { return false };
                if user.id == session.me.id {
                    session.users.insert(user.id.clone(), user.clone());
                    session.me = user;
                }
            }
            "MESSAGE_CREATE" => {
                let Ok(message) = serde_json::from_value::<Message>(data) else { return false };
                session.users.entry(message.author.id.clone()).or_insert_with(|| message.author.clone());
                if let Some(dm) = session.dms.iter_mut().find(|channel| channel.id == message.channel_id) {
                    dm.last_message_id = Some(message.id.clone());
                    sorted_dms(&mut session.dms);
                }
                if session.selected_channel.as_deref() != Some(message.channel_id.as_str()) || session.messages.iter().any(|existing| existing.id == message.id) {
                    return session.selected_guild == DIRECT_MESSAGES;
                }
                session.messages.push(message);
            }
            "MESSAGE_UPDATE" => {
                let (Some(id), Some(channel_id)) = (data.get("id").and_then(Value::as_str), data.get("channel_id").and_then(Value::as_str)) else {
                    return false;
                };
                if session.selected_channel.as_deref() != Some(channel_id) {
                    return false;
                }
                let Some(message) = session.messages.iter_mut().find(|message| message.id == id) else {
                    return false;
                };
                merge_message(message, &data);
            }
            "MESSAGE_DELETE" => {
                let Ok(deleted) = serde_json::from_value::<MessageDelete>(data) else { return false };
                if session.selected_channel.as_deref() != Some(deleted.channel_id.as_str()) {
                    return false;
                }
                session.messages.retain(|message| message.id != deleted.id);
            }
            "MESSAGE_DELETE_BULK" => {
                let ids: Vec<String> = data.get("ids").and_then(|ids| serde_json::from_value(ids.clone()).ok()).unwrap_or_default();
                session.messages.retain(|message| !ids.contains(&message.id));
            }
            _ => return false,
        }
        true
    }

    fn guild<'a>(&self, session: &'a Session, id: &str) -> Option<&'a Guild> {
        session.guilds.iter().find(|guild| guild.id == id)
    }

    fn channel<'a>(&self, session: &'a Session, id: &str) -> Option<&'a Channel> {
        session
            .dms
            .iter()
            .chain(session.guilds.iter().flat_map(|guild| guild.channels.iter()))
            .find(|channel| channel.id == id)
    }

    fn listed_channels(&self, session: &Session) -> Vec<ListedChannel> {
        if session.selected_guild == DIRECT_MESSAGES {
            return session
                .dms
                .iter()
                .map(|channel| ListedChannel {
                    id: channel.id.clone(),
                    name: channel.title(&session.me.id),
                    prefix: prefix(channel),
                    is_category: false,
                    enabled: true,
                })
                .collect();
        }
        let Some(guild) = self.guild(session, &session.selected_guild) else { return Vec::new() };
        let roles = session.member_roles.get(&guild.id).cloned().unwrap_or_default();
        guild_channels(guild, &session.me.id, &roles)
    }

    fn channel_selectable(&self, session: &Session, id: &str) -> bool {
        self.listed_channels(session).iter().any(|channel| channel.id == id && channel.enabled)
    }

    fn default_channel(&self, session: &Session) -> Option<String> {
        self.listed_channels(session).into_iter().find(|channel| channel.enabled).map(|channel| channel.id)
    }

    fn channel_permissions(&self, session: &Session, channel: &Channel) -> u128 {
        let Some(guild) = channel.guild_id.as_deref().and_then(|id| self.guild(session, id)) else {
            return 0;
        };
        let roles = session.member_roles.get(&guild.id).cloned().unwrap_or_default();
        permissions::in_channel(guild, &session.me.id, &roles, channel)
    }

    fn select_guild(&self, ui: &AppWindow, state: &mut State, id: String) {
        let Some(session) = state.session.as_mut() else { return };
        if session.selected_guild == id {
            return;
        }
        session.selected_guild = id;
        session.selected_channel = self.default_channel(session);
        self.load_messages(state, None);
        self.render(ui, state);
    }

    fn select_channel(&self, ui: &AppWindow, state: &mut State, id: String) {
        let Some(session) = state.session.as_mut() else { return };
        if session.selected_channel.as_deref() == Some(id.as_str()) || !self.channel_selectable(session, &id) {
            return;
        }
        session.selected_channel = Some(id);
        self.load_messages(state, None);
        self.render(ui, state);
    }

    fn load_older(&self, ui: &AppWindow, state: &mut State) {
        let Some(session) = state.session.as_ref() else { return };
        if session.loading || !session.has_older {
            return;
        }
        let before = session.messages.first().map(|message| message.id.clone());
        self.load_messages(state, before);
        self.render(ui, state);
    }

    fn load_messages(&self, state: &mut State, before: Option<String>) {
        let Some(session) = state.session.as_mut() else { return };
        if before.is_none() {
            session.messages.clear();
            session.has_older = false;
        }
        let Some(channel_id) = session.selected_channel.clone() else {
            session.loading = false;
            return;
        };
        session.loading = true;
        let api = session.api.clone();
        let generation = session.generation;
        let app = self.clone();
        self.runtime.spawn(async move {
            let result = api.messages(&channel_id, before.as_deref()).await;
            app.later(move |app, ui, state| {
                let Some(session) = state
                    .session
                    .as_mut()
                    .filter(|session| session.generation == generation && session.selected_channel.as_deref() == Some(channel_id.as_str()))
                else {
                    return;
                };
                session.loading = false;
                let mut scroll = false;
                match result {
                    Ok(mut page) => {
                        session.has_older = page.len() >= PAGE_SIZE;
                        for message in &page {
                            session.users.entry(message.author.id.clone()).or_insert_with(|| message.author.clone());
                        }
                        if before.is_some() {
                            page.retain(|message| !session.messages.iter().any(|existing| existing.id == message.id));
                            page.append(&mut session.messages);
                            session.messages = page;
                        } else {
                            let live: Vec<Message> = session.messages.drain(..).filter(|message| !page.iter().any(|loaded| loaded.id == message.id)).collect();
                            page.extend(live);
                            session.messages = page;
                            scroll = true;
                        }
                    }
                    Err(ApiError::Unauthorized) => return app.session_ended(ui, state, "Your session has ended. Log in again."),
                    Err(ApiError::Message(error)) => session.status = error,
                }
                app.render(ui, state);
                if scroll {
                    ui.invoke_scroll_to_bottom();
                }
            });
        });
    }

    fn send_message(&self, ui: &AppWindow, state: &mut State, content: String) {
        let Some(session) = state.session.as_ref() else { return };
        let content = content.trim().to_string();
        let Some(channel_id) = session.selected_channel.clone() else { return };
        if content.is_empty() || !self.can_send(session) {
            return;
        }
        let api = session.api.clone();
        let generation = session.generation;
        let app = self.clone();
        ui.invoke_scroll_to_bottom();
        self.runtime.spawn(async move {
            let result = api.send(&channel_id, &content).await;
            app.later(move |app, ui, state| {
                let Some(session) = state.session.as_mut().filter(|session| session.generation == generation) else {
                    return;
                };
                match result {
                    Ok(message) => {
                        if session.selected_channel.as_deref() == Some(message.channel_id.as_str()) && !session.messages.iter().any(|existing| existing.id == message.id) {
                            session.messages.push(message);
                        }
                    }
                    Err(ApiError::Unauthorized) => return app.session_ended(ui, state, "Your session has ended. Log in again."),
                    Err(ApiError::Message(error)) => session.status = format!("Your message wasn't sent: {error}"),
                }
                app.render(ui, state);
            });
        });
    }

    fn can_send(&self, session: &Session) -> bool {
        let Some(channel) = session.selected_channel.as_deref().and_then(|id| self.channel(session, id)) else {
            return false;
        };
        if channel.is_encrypted() {
            return false;
        }
        permissions::can(self.channel_permissions(session, channel), permissions::VIEW_CHANNEL | permissions::SEND_MESSAGES)
    }

    fn image(&self, state: &mut State, url: Option<String>) -> Option<Image> {
        let url = url?;
        if let Some(entry) = state.images.get(&url) {
            return entry.clone().map(Image::from_rgba8);
        }
        state.images.insert(url.clone(), None);
        let api = state.session.as_ref()?.api.clone();
        let app = self.clone();
        self.runtime.spawn(async move {
            let Some(bytes) = api.image(&url).await else { return };
            let Some(buffer) = tokio::task::spawn_blocking(move || images::decode(&bytes)).await.ok().flatten() else {
                return;
            };
            app.later(move |app, ui, state| {
                state.images.insert(url, Some(buffer));
                app.render(ui, state);
            });
        });
        None
    }

    fn render(&self, ui: &AppWindow, state: &mut State) {
        ui.set_screen(state.screen);
        ui.set_connecting_text(state.connecting_text.clone().into());
        match state.screen {
            PICKER => self.render_picker(ui, state),
            LOGIN => self.render_login(ui, state),
            MAIN => self.render_main(ui, state),
            _ => ui.set_window_title(APP_NAME.into()),
        }
    }

    fn render_picker(&self, ui: &AppWindow, state: &State) {
        ui.set_window_title(APP_NAME.into());
        ui.set_instances(rows(
            state
                .store
                .instances
                .iter()
                .map(|instance| InstanceRow {
                    id: instance.id.clone().into(),
                    name: instance.name.clone().into(),
                    host: instance.host().into(),
                })
                .collect(),
        ));
        ui.set_picker_error(state.picker_error.clone().into());
        ui.set_looking_up(state.looking_up);
        ui.set_has_preview(state.preview.is_some());
        if let Some(preview) = &state.preview {
            ui.set_preview_name(preview.name.clone().into());
            ui.set_preview_host(preview.host().into());
            ui.set_preview_description(preview.description.clone().into());
            ui.set_preview_signups(
                if preview.registration_open {
                    "Anyone can sign up."
                } else {
                    "Signups are closed. You need an existing account."
                }
                .into(),
            );
        }
    }

    fn render_login(&self, ui: &AppWindow, state: &State) {
        let Some(login) = &state.login else { return };
        ui.set_window_title(format!("{} - {APP_NAME}", login.instance.name).into());
        ui.set_login_instance(format!("{} ({})", login.instance.name, login.instance.host()).into());
        ui.set_login_error(login.error.clone().into());
        ui.set_login_busy(login.busy);
        ui.set_needs_code(login.ticket.is_some());
        ui.set_signups_open(login.instance.registration_open);
    }

    fn render_main(&self, ui: &AppWindow, state: &mut State) {
        let Some(session) = state.session.as_ref() else { return };
        let cdn = session.instance.cdn();
        let mut guild_specs = vec![(DIRECT_MESSAGES.to_string(), "Direct Messages".to_string(), "DM".to_string(), None)];
        for guild in &session.guilds {
            let icon = guild.icon.as_deref().map(|hash| images::guild_icon(&cdn, &guild.id, hash));
            guild_specs.push((guild.id.clone(), guild.name.clone(), text::initials(&guild.name), icon));
        }
        let selected_guild = session.selected_guild.clone();
        let selected_channel = session.selected_channel.clone();
        let listed = self.listed_channels(session);
        let channel = selected_channel.as_deref().and_then(|id| self.channel(session, id)).cloned();
        let sidebar_title = self
            .guild(session, &selected_guild)
            .map(|guild| guild.name.clone())
            .unwrap_or_else(|| "Direct Messages".into());
        let me = session.me.clone();
        let can_send = self.can_send(session);
        let encrypted = channel.as_ref().is_some_and(Channel::is_encrypted);
        let status = session.status.clone();
        let loading = session.loading;
        let has_older = session.has_older;
        let instance_name = session.instance.name.clone();
        let messages = session.messages.clone();
        let users = session.users.clone();
        let channel_names: HashMap<String, String> = session
            .guilds
            .iter()
            .flat_map(|guild| guild.channels.iter())
            .map(|channel| (channel.id.clone(), channel.name.clone().unwrap_or_default()))
            .collect();
        let role_names: HashMap<String, String> = self
            .guild(session, &selected_guild)
            .map(|guild| guild.roles.iter().map(|role| (role.id.clone(), role.name.clone())).collect())
            .unwrap_or_default();

        let guild_rows: Vec<GuildRow> = guild_specs
            .into_iter()
            .map(|(id, name, initials, icon)| {
                let image = self.image(state, icon);
                GuildRow {
                    selected: id == selected_guild,
                    id: id.into(),
                    name: name.into(),
                    initials: initials.into(),
                    has_icon: image.is_some(),
                    icon: image.unwrap_or_default(),
                }
            })
            .collect();
        ui.set_guilds(rows(guild_rows));
        ui.set_channels(rows(
            listed
                .iter()
                .map(|channel| ChannelRow {
                    id: channel.id.clone().into(),
                    name: channel.name.clone().into(),
                    prefix: channel.prefix.into(),
                    is_category: channel.is_category,
                    enabled: channel.enabled,
                    selected: selected_channel.as_deref() == Some(channel.id.as_str()),
                })
                .collect(),
        ));
        ui.set_sidebar_title(sidebar_title.into());
        ui.set_user_name(me.display_name().into());
        ui.set_window_title(instance_name.into());
        ui.set_status_text(status.into());
        ui.set_has_channel(channel.is_some());
        ui.set_loading_messages(loading);
        ui.set_can_load_older(has_older);
        ui.set_can_send(can_send);
        ui.set_show_open_in_browser(encrypted);
        let title = channel.as_ref().map(|channel| format!("{}{}", prefix(channel), channel.title(&me.id))).unwrap_or_default();
        ui.set_channel_title(title.clone().into());
        ui.set_channel_topic(channel.as_ref().and_then(|channel| channel.topic.clone()).unwrap_or_default().into());
        ui.set_composer_placeholder(
            if encrypted {
                "Encrypted conversations can't be read or sent in this app yet.".to_string()
            } else if can_send {
                format!("Message {title}")
            } else {
                "You can't send messages here.".to_string()
            }
            .into(),
        );

        let user_name = |id: &str| users.get(id).map(User::display_name);
        let channel_name = |id: &str| channel_names.get(id).cloned();
        let role_name = |id: &str| role_names.get(id).cloned();
        let names = text::Names {
            user: &user_name,
            channel: &channel_name,
            role: &role_name,
        };
        let now = chrono::Local::now();
        let mut message_rows = Vec::with_capacity(messages.len());
        for (index, message) in messages.iter().enumerate() {
            let compact = groups_with_previous(index.checked_sub(1).map(|previous| &messages[previous]), message);
            let (content, notice) = if message.is_encrypted() {
                (ENCRYPTED_NOTICE.to_string(), true)
            } else if !is_normal(message) {
                (system_text(message), true)
            } else {
                let mut content = text::render(&message.content, &names);
                for sticker in &message.sticker_items {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str(&format!("[Sticker: {}]", sticker.name));
                }
                (content, false)
            };
            let avatar_url = message.author.avatar.as_deref().map(|hash| images::avatar(&cdn, &message.author.id, hash));
            let avatar = if compact { None } else { self.image(state, avatar_url) };
            let attachments: Vec<AttachmentRow> = if message.is_encrypted() {
                Vec::new()
            } else {
                message
                    .attachments
                    .iter()
                    .map(|attachment| AttachmentRow {
                        name: attachment.filename.clone().into(),
                        size: text::file_size(attachment.size).into(),
                        url: attachment.url.clone().into(),
                    })
                    .collect()
            };
            let author = message.author.display_name();
            message_rows.push(MessageRow {
                id: message.id.clone().into(),
                initials: text::initials(&author).into(),
                author: author.into(),
                has_avatar: avatar.is_some(),
                avatar: avatar.unwrap_or_default(),
                time: text::message_time(&message.timestamp, now).into(),
                content: content.into(),
                compact,
                edited: message.edited_timestamp.is_some() && !notice,
                notice,
                attachments: rows(attachments),
            });
        }
        ui.set_messages(rows(message_rows));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Overwrite;

    fn channel(id: &str, kind: u8, name: &str, parent: Option<&str>, position: i64) -> Channel {
        Channel {
            id: id.into(),
            kind,
            name: Some(name.into()),
            parent_id: parent.map(Into::into),
            position,
            guild_id: Some("g".into()),
            ..Default::default()
        }
    }

    fn guild() -> Guild {
        Guild {
            id: "g".into(),
            owner_id: "owner".into(),
            roles: vec![Role {
                id: "g".into(),
                permissions: permissions::VIEW_CHANNEL | permissions::SEND_MESSAGES,
                ..Default::default()
            }],
            channels: vec![
                channel("1", channel_type::GUILD_CATEGORY, "Text Channels", None, 0),
                channel("2", channel_type::GUILD_TEXT, "general", Some("1"), 1),
                channel("3", channel_type::GUILD_CATEGORY, "Voice Channels", None, 2),
                channel("4", channel_type::GUILD_VOICE, "General", Some("3"), 3),
                channel("5", channel_type::GUILD_TEXT, "rules", None, 0),
                Channel {
                    permission_overwrites: vec![Overwrite {
                        id: "g".into(),
                        is_member: false,
                        allow: 0,
                        deny: permissions::VIEW_CHANNEL,
                    }],
                    ..channel("6", channel_type::GUILD_TEXT, "staff", Some("1"), 2)
                },
                channel("7", 11, "a thread", Some("2"), 0),
            ],
            ..Default::default()
        }
    }

    #[test]
    fn channels_are_listed_in_order_without_hidden_ones() {
        let listed = guild_channels(&guild(), "member", &[]);
        let names: Vec<&str> = listed.iter().map(|channel| channel.name.as_str()).collect();
        assert_eq!(names, ["rules", "TEXT CHANNELS", "general", "VOICE CHANNELS", "General"]);
        assert!(listed[1].is_category);
        assert!(listed[2].enabled);
        assert!(!listed[4].enabled);
        assert_eq!(listed[4].prefix, "•");
    }

    #[test]
    fn the_owner_sees_hidden_channels() {
        let listed = guild_channels(&guild(), "owner", &[]);
        assert!(listed.iter().any(|channel| channel.name == "staff"));
    }

    fn message(id: &str, author: &str, timestamp: &str, kind: u8) -> Message {
        Message {
            id: id.into(),
            channel_id: "c".into(),
            author: User {
                id: author.into(),
                username: author.into(),
                ..Default::default()
            },
            timestamp: timestamp.into(),
            kind,
            ..Default::default()
        }
    }

    #[test]
    fn messages_group_by_author_within_seven_minutes() {
        let first = message("1", "a", "2026-11-11T10:00:00Z", 0);
        assert!(!groups_with_previous(None, &first));
        assert!(groups_with_previous(Some(&first), &message("2", "a", "2026-11-11T10:05:00Z", 0)));
        assert!(!groups_with_previous(Some(&first), &message("3", "a", "2026-11-11T10:08:00Z", 0)));
        assert!(!groups_with_previous(Some(&first), &message("4", "b", "2026-11-11T10:01:00Z", 0)));
        assert!(!groups_with_previous(Some(&first), &message("5", "a", "2026-11-11T10:01:00Z", 19)));
    }

    #[test]
    fn edits_merge_into_the_loaded_message() {
        let mut loaded = message("1", "a", "2026-11-11T10:00:00Z", 0);
        merge_message(
            &mut loaded,
            &serde_json::json!({ "id": "1", "content": "fixed", "edited_timestamp": "2026-11-11T10:01:00Z" }),
        );
        assert_eq!(loaded.content, "fixed");
        assert!(loaded.edited_timestamp.is_some());
    }

    #[test]
    fn recent_dms_come_first() {
        let mut dms = vec![
            Channel {
                id: "10".into(),
                last_message_id: Some("20".into()),
                ..Default::default()
            },
            Channel {
                id: "11".into(),
                last_message_id: Some("30".into()),
                ..Default::default()
            },
            Channel {
                id: "12".into(),
                last_message_id: None,
                ..Default::default()
            },
        ];
        sorted_dms(&mut dms);
        let order: Vec<&str> = dms.iter().map(|channel| channel.id.as_str()).collect();
        assert_eq!(order, ["11", "10", "12"]);
    }
}
