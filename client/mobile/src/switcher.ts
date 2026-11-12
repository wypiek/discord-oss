type AnyRecord = Record<PropertyKey, any>;
type Listener = () => void;

export type SavedInstance = { url: string; name: string };

type SwitcherOptions = {
    currentOrigin: string;
    nativeModule: (name: string) => AnyRecord | null;
    log: (message: string) => void;
};

type Loader = { configPath: string; cachedBundle: string | null };

const INSTANCES_FILE = "discord-oss/instances.json";
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)(:\d+)?$/i;
const BLURPLE = "#5865f2";
const BACKGROUND = "#1a1a1e";
const SURFACE = "#242429";
const TEXT = "#f2f3f5";
const MUTED = "#b5bac1";
const DANGER = "#f23f43";

const g = globalThis as AnyRecord;

export const originOf = (url: string) => {
    const match = /^(https?):\/\/([^/?#]+)/i.exec(url.trim());
    return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}` : null;
};

export const hostOf = (origin: string) => origin.replace(/^https?:\/\//, "");

export const normalizeInstanceInput = (input: string) => {
    const text = input.trim().replace(/\/+$/, "");
    if (!text) throw new Error("Enter the address of a Discord OSS instance.");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${LOCAL_HOST.test(text.split("/")[0]) ? "http" : "https"}://${text}`;
    const origin = originOf(withScheme);
    if (!origin) throw new Error("Only http and https addresses work.");
    return origin;
};

const detectLoader = (): Loader | null => {
    if (g.__PYON_LOADER__ != null) return { configPath: "pyoncord/loader.json", cachedBundle: "pyoncord/bundle.js" };
    if (g.__RAIN_LOADER__ != null) return { configPath: "rain/loader.json", cachedBundle: null };
    if (g.__vendetta_loader != null) return { configPath: "vendetta_loader.json", cachedBundle: null };
    return null;
};

export const createInstanceSwitcher = (options: SwitcherOptions) => {
    const listeners = new Set<Listener>();
    const state = { open: false, loggedIn: null as boolean | null, sawAuthorization: false };
    let react: AnyRecord | null = null;
    let reactNative: AnyRecord | null = null;
    const startedAt = Date.now();
    const watched = new WeakSet<object>();

    const emit = () => {
        for (const listener of listeners) listener();
    };

    const files = () => {
        const module = options.nativeModule("NativeFileModule");
        if (!module || typeof module.readFile !== "function" || typeof module.writeFile !== "function") return null;
        const constants = typeof module.getConstants === "function" ? module.getConstants() : module;
        const documents = String(constants?.DocumentsDirPath ?? "");
        return documents ? { module, documents } : null;
    };

    const readJson = async <T>(relative: string): Promise<T | null> => {
        const fs = files();
        if (!fs) return null;
        const path = `${fs.documents}/${relative}`;
        try {
            if (typeof fs.module.fileExists === "function" && !(await fs.module.fileExists(path))) return null;
            return JSON.parse(String(await fs.module.readFile(path, "utf8"))) as T;
        } catch {
            return null;
        }
    };

    const writeJson = async (relative: string, value: unknown) => {
        const fs = files();
        if (!fs) throw new Error("This app can't save files, so the instance can't be switched from here.");
        await fs.module.writeFile("documents", relative, JSON.stringify(value), "utf8");
    };

    const loadInstances = async (): Promise<SavedInstance[]> => {
        const stored = await readJson<SavedInstance[]>(INSTANCES_FILE);
        const list = Array.isArray(stored) ? stored.filter((item) => item && typeof item.url === "string" && typeof item.name === "string") : [];
        if (!list.some((item) => item.url === options.currentOrigin)) list.unshift({ url: options.currentOrigin, name: hostOf(options.currentOrigin) });
        return list;
    };

    const saveInstances = (list: SavedInstance[]) => writeJson(INSTANCES_FILE, list);

    const discover = async (input: string): Promise<SavedInstance> => {
        const origin = normalizeInstanceInput(input);
        const host = hostOf(origin);
        let response: Response;
        try {
            response = await fetch(`${origin}/.well-known/discord-oss`, { headers: { accept: "application/json" } });
        } catch {
            throw new Error(`Couldn't reach ${host}. Check the address and your connection.`);
        }
        if (!response.ok) throw new Error(`${host} isn't a Discord OSS instance (HTTP ${response.status}).`);
        const body = (await response.json().catch(() => null)) as { software?: { name?: string }; instance?: { url?: string; name?: string } } | null;
        if (body?.software?.name !== "discord-oss") throw new Error(`${host} isn't a Discord OSS instance.`);
        const url = (body.instance?.url && originOf(body.instance.url)) || origin;
        if (!/^https:/.test(url)) throw new Error(`${hostOf(url)} doesn't use HTTPS. Discord's app only connects to instances with a trusted HTTPS certificate.`);
        const bundle = await fetch(`${url}/mobile/meowcord.js`, { method: "HEAD" }).catch(() => null);
        if (!bundle?.ok) throw new Error(`${hostOf(url)} doesn't serve the mobile bundle at /mobile/meowcord.js.`);
        return { url, name: body.instance?.name?.trim() || hostOf(url) };
    };

    const reload = () => {
        const updater = options.nativeModule("BundleUpdaterManager");
        if (updater && typeof updater.reload === "function") {
            updater.reload();
            return true;
        }
        const devSettings = options.nativeModule("DevSettings");
        if (devSettings && typeof devSettings.reload === "function") {
            devSettings.reload();
            return true;
        }
        return false;
    };

    const switchTo = async (instance: SavedInstance) => {
        const loader = detectLoader();
        const bundleUrl = `${instance.url}/mobile/meowcord.js`;
        if (!loader) throw new Error(`Your mod loader isn't supported here. Set its custom bundle URL to ${bundleUrl} and restart the app.`);
        const config = (await readJson<AnyRecord>(loader.configPath)) ?? {};
        await writeJson(loader.configPath, { loadReactDevTools: false, ...config, customLoadUrl: { enabled: true, url: bundleUrl } });
        const list = await loadInstances();
        await saveInstances([instance, ...list.filter((item) => item.url !== instance.url)]);
        const fs = files();
        if (loader.cachedBundle && fs && typeof fs.module.removeFile === "function")
            await Promise.resolve(fs.module.removeFile("cache", loader.cachedBundle)).catch(() => undefined);
        options.log(`switching to ${instance.url}`);
        if (!reload()) throw new Error(`Saved. Close the app completely and open it again to connect to ${instance.name}.`);
    };

    const removeInstance = async (url: string) => {
        if (url === options.currentOrigin) return;
        await saveInstances((await loadInstances()).filter((item) => item.url !== url));
    };

    const setLoggedIn = (value: boolean) => {
        if (state.loggedIn === value) return;
        state.loggedIn = value;
        emit();
    };

    const open = () => {
        state.open = true;
        emit();
    };

    const close = () => {
        state.open = false;
        emit();
    };

    const showBanner = () => state.loggedIn === false || (state.loggedIn === null && !state.sawAuthorization && Date.now() - startedAt > 8000);

    const useSwitcherState = () => {
        const R = react!;
        const [, setTick] = R.useState(0);
        R.useEffect(() => {
            const listener = () => setTick((tick: number) => tick + 1);
            listeners.add(listener);
            const timer = setTimeout(listener, 8500);
            return () => {
                listeners.delete(listener);
                clearTimeout(timer);
            };
        }, []);
        return state;
    };

    const Banner = () => {
        const R = react!;
        const RN = reactNative!;
        return R.createElement(
            RN.Pressable,
            {
                onPress: open,
                accessibilityRole: "button",
                accessibilityLabel: `Connected to ${hostOf(options.currentOrigin)}. Change instance.`,
                style: {
                    position: "absolute",
                    left: 16,
                    right: 16,
                    bottom: 28,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: SURFACE,
                },
            },
            R.createElement(RN.Text, { numberOfLines: 1, style: { color: MUTED, fontSize: 13, flexShrink: 1 } }, `Instance: ${hostOf(options.currentOrigin)}`),
            R.createElement(RN.Text, { style: { color: BLURPLE, fontSize: 13, fontWeight: "700", marginLeft: 12 } }, "Change"),
        );
    };

    const Button = (props: { label: string; onPress: () => void; disabled?: boolean; tone?: "primary" | "secondary" }) => {
        const R = react!;
        const RN = reactNative!;
        const primary = props.tone !== "secondary";
        return R.createElement(
            RN.Pressable,
            {
                onPress: props.onPress,
                disabled: props.disabled,
                accessibilityRole: "button",
                style: {
                    alignItems: "center",
                    paddingVertical: 12,
                    borderRadius: 8,
                    marginTop: 12,
                    opacity: props.disabled ? 0.5 : 1,
                    backgroundColor: primary ? BLURPLE : SURFACE,
                },
            },
            R.createElement(RN.Text, { style: { color: TEXT, fontSize: 15, fontWeight: "600" } }, props.label),
        );
    };

    const Screen = () => {
        const R = react!;
        const RN = reactNative!;
        const [instances, setInstances] = R.useState([] as SavedInstance[]);
        const [address, setAddress] = R.useState("");
        const [busy, setBusy] = R.useState(null as string | null);
        const [error, setError] = R.useState(null as string | null);

        R.useEffect(() => {
            loadInstances().then(setInstances, () => setInstances([{ url: options.currentOrigin, name: hostOf(options.currentOrigin) }]));
        }, []);

        const run = (label: string, task: () => Promise<unknown>) => {
            setBusy(label);
            setError(null);
            task().then(
                () => setBusy(null),
                (failure: unknown) => {
                    setBusy(null);
                    setError(failure instanceof Error ? failure.message : String(failure));
                },
            );
        };

        const connect = () => run("Checking", async () => switchTo(await discover(address)));
        const choose = (instance: SavedInstance) => {
            if (instance.url === options.currentOrigin) return close();
            run("Switching", () => switchTo(instance));
        };
        const forget = (instance: SavedInstance) =>
            run("Removing", async () => {
                await removeInstance(instance.url);
                setInstances(await loadInstances());
            });

        const rows = instances.map((instance: SavedInstance) => {
            const current = instance.url === options.currentOrigin;
            return R.createElement(
                RN.Pressable,
                {
                    key: instance.url,
                    onPress: () => choose(instance),
                    onLongPress: () => forget(instance),
                    disabled: !!busy,
                    accessibilityRole: "button",
                    accessibilityHint: current ? undefined : "Long press to remove it from the list.",
                    style: {
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        borderRadius: 10,
                        marginBottom: 8,
                        backgroundColor: SURFACE,
                        borderWidth: current ? 1 : 0,
                        borderColor: BLURPLE,
                    },
                },
                R.createElement(
                    RN.View,
                    { style: { flex: 1 } },
                    R.createElement(RN.Text, { numberOfLines: 1, style: { color: TEXT, fontSize: 16, fontWeight: "600" } }, instance.name),
                    R.createElement(RN.Text, { numberOfLines: 1, style: { color: MUTED, fontSize: 13, marginTop: 2 } }, hostOf(instance.url)),
                ),
                current ? R.createElement(RN.Text, { style: { color: BLURPLE, fontSize: 12, fontWeight: "700" } }, "CURRENT") : null,
            );
        });

        return R.createElement(
            RN.View,
            { style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BACKGROUND, zIndex: 9999, elevation: 9999 } },
            R.createElement(
                RN.ScrollView,
                { keyboardShouldPersistTaps: "handled", contentContainerStyle: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 } },
                R.createElement(RN.Text, { style: { color: TEXT, fontSize: 24, fontWeight: "800" } }, "Switch instance"),
                R.createElement(
                    RN.Text,
                    { style: { color: MUTED, fontSize: 14, marginTop: 6, marginBottom: 20 } },
                    "Pick a Discord OSS instance. The app restarts on the one you choose, and you sign in to it with that instance's account.",
                ),
                ...rows,
                R.createElement(RN.Text, { style: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 20, marginBottom: 8 } }, "ADD AN INSTANCE"),
                R.createElement(RN.TextInput, {
                    value: address,
                    onChangeText: setAddress,
                    onSubmitEditing: connect,
                    placeholder: "chat.example.com",
                    placeholderTextColor: "#80848e",
                    autoCapitalize: "none",
                    autoCorrect: false,
                    keyboardType: "url",
                    returnKeyType: "go",
                    editable: !busy,
                    style: { color: TEXT, fontSize: 16, padding: 12, borderRadius: 8, backgroundColor: SURFACE },
                }),
                error ? R.createElement(RN.Text, { style: { color: DANGER, fontSize: 13, marginTop: 10 } }, error) : null,
                R.createElement(Button, { label: busy ? `${busy}…` : "Connect", onPress: connect, disabled: !!busy || !address.trim() }),
                R.createElement(Button, { label: "Cancel", onPress: close, disabled: !!busy, tone: "secondary" }),
            ),
        );
    };

    const wrapRoot = (Root: unknown) => {
        if (typeof Root !== "function" && (typeof Root !== "object" || Root === null)) return Root;
        const Host = (props: AnyRecord) => {
            const R = react;
            const RN = reactNative;
            if (!R || !RN) return null;
            const current = useSwitcherState();
            return R.createElement(
                RN.View,
                { style: { flex: 1 } },
                R.createElement(Root, props),
                !current.open && showBanner() ? R.createElement(Banner, null) : null,
                current.open ? R.createElement(Screen, null) : null,
            );
        };
        return Host;
    };

    const patchAppRegistry = (registry: AnyRecord) => {
        const register = registry.registerComponent;
        return (key: string, provider: () => unknown, ...rest: unknown[]) =>
            register.call(registry, key, () => (react && reactNative ? wrapRoot(provider()) : provider()), ...rest);
    };

    const watchDispatcher = (dispatcher: AnyRecord) => {
        dispatcher.subscribe("LOGOUT", () => setLoggedIn(false));
        dispatcher.subscribe("CONNECTION_OPEN", () => setLoggedIn(true));
        dispatcher.subscribe("LOGIN_SUCCESS", () => setLoggedIn(true));
    };

    g.DiscordOSS = { ...(g.DiscordOSS ?? {}), openInstanceSwitcher: open, currentInstance: options.currentOrigin };

    return {
        open,
        discover,
        switchTo,
        noteAuthorization: () => {
            state.sawAuthorization = true;
            if (state.loggedIn === null) setLoggedIn(true);
        },
        inspect: (exports: AnyRecord): AnyRecord | null => {
            if (!react && typeof exports.createElement === "function" && typeof exports.useState === "function" && typeof exports.useEffect === "function") react = exports;
            if (!reactNative && "AppRegistry" in exports && "View" in exports && "TextInput" in exports && "Pressable" in exports) reactNative = exports;
            for (const candidate of [exports, exports.default]) {
                if (!candidate || typeof candidate !== "object") continue;
                if (
                    typeof candidate.subscribe === "function" &&
                    typeof candidate.dispatch === "function" &&
                    typeof candidate.addInterceptor === "function" &&
                    !watched.has(candidate)
                ) {
                    watched.add(candidate);
                    watchDispatcher(candidate);
                }
            }
            if (typeof exports.registerComponent === "function" && typeof exports.runApplication === "function") return { registerComponent: patchAppRegistry(exports) };
            if (exports.default && typeof exports.default.registerComponent === "function" && typeof exports.default.runApplication === "function")
                return { default: Object.assign(Object.create(exports.default), { registerComponent: patchAppRegistry(exports.default) }) };
            return null;
        },
    };
};
