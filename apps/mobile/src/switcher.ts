const STORE_KEY = "discord-oss.instances";
const CURRENT_KEY = "discord-oss.current";
const localHost = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)(:\d+)?$/i;

const card = document.getElementById("card") as HTMLElement;
const list = document.getElementById("instances") as HTMLUListElement;
const form = document.getElementById("connect") as HTMLFormElement;
const address = document.getElementById("address") as HTMLInputElement;
const submit = document.getElementById("submit") as HTMLButtonElement;
const errorText = document.getElementById("error") as HTMLParagraphElement;

function loadInstances(): SavedInstance[] {
    try {
        const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
        return Array.isArray(stored) ? stored : [];
    } catch {
        return [];
    }
}

function storeInstances(instances: SavedInstance[]) {
    localStorage.setItem(STORE_KEY, JSON.stringify(instances));
}

function normalize(input: string) {
    const text = input.trim();
    if (!text) throw new Error("Enter the address of a Discord OSS instance.");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${localHost.test(text.split("/")[0]) ? "http" : "https"}://${text}`;
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https addresses work.");
    return url.origin;
}

async function discover(input: string): Promise<Omit<SavedInstance, "lastUsed">> {
    const origin = normalize(input);
    const host = new URL(origin).host;
    let response: Response;
    try {
        response = await fetch(`${origin}/.well-known/discord-oss`, { headers: { accept: "application/json" } });
    } catch {
        throw new Error(`Couldn't reach ${host}. Check the address and your connection.`);
    }
    if (!response.ok) throw new Error(`${host} isn't a Discord OSS instance (HTTP ${response.status}).`);
    const body = await response.json().catch(() => null);
    if (body?.software?.name !== "discord-oss") throw new Error(`${host} isn't a Discord OSS instance.`);
    const url = body.instance?.url ? new URL(body.instance.url).origin : origin;
    return { url, name: String(body.instance?.name ?? "").trim() || new URL(url).host, icon: typeof body.instance?.icon === "string" ? body.instance.icon : null };
}

function go(url: string) {
    localStorage.setItem(CURRENT_KEY, url);
    if (window.DiscordOSSAndroid) window.DiscordOSSAndroid.openInstance(url);
    else location.replace(`${url}/channels/@me`);
}

function showError(message: string | null) {
    errorText.hidden = !message;
    errorText.textContent = message ?? "";
}

function busy(value: boolean) {
    submit.disabled = value;
    address.disabled = value;
    submit.textContent = value ? "Connecting…" : "Connect";
    for (const button of list.querySelectorAll("button")) button.disabled = value;
}

async function connect(input: string) {
    busy(true);
    showError(null);
    try {
        const instance = await discover(input);
        storeInstances([{ ...instance, lastUsed: Date.now() }, ...loadInstances().filter((saved) => saved.url !== instance.url)]);
        go(instance.url);
    } catch (error) {
        busy(false);
        showError(error instanceof Error ? error.message : String(error));
    }
}

function initials(name: string) {
    return (
        name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0]?.toUpperCase())
            .join("") || "?"
    );
}

function render() {
    const instances = loadInstances().sort((a, b) => b.lastUsed - a.lastUsed);
    const current = localStorage.getItem(CURRENT_KEY);
    list.replaceChildren();
    list.hidden = instances.length === 0;
    for (const instance of instances) {
        const item = document.createElement("li");
        item.className = instance.url === current ? "instance current" : "instance";
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "open";
        openButton.addEventListener("click", () => {
            storeInstances(loadInstances().map((saved) => (saved.url === instance.url ? { ...saved, lastUsed: Date.now() } : saved)));
            go(instance.url);
        });
        const avatar = document.createElement("span");
        avatar.className = "avatar";
        if (instance.icon) {
            const image = document.createElement("img");
            image.src = instance.icon;
            image.alt = "";
            image.addEventListener("error", () => {
                image.remove();
                avatar.textContent = initials(instance.name);
            });
            avatar.append(image);
        } else {
            avatar.textContent = initials(instance.name);
        }
        const text = document.createElement("span");
        text.className = "text";
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = instance.name;
        const host = document.createElement("span");
        host.className = "host";
        host.textContent = new URL(instance.url).host;
        text.append(name, host);
        openButton.append(avatar, text);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove";
        remove.setAttribute("aria-label", `Remove ${instance.name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
            storeInstances(loadInstances().filter((saved) => saved.url !== instance.url));
            if (localStorage.getItem(CURRENT_KEY) === instance.url) localStorage.removeItem(CURRENT_KEY);
            window.DiscordOSSAndroid?.removeInstance(instance.url);
            render();
        });
        item.append(openButton, remove);
        list.append(item);
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    connect(address.value);
});

const params = new URLSearchParams(location.search);
const current = localStorage.getItem(CURRENT_KEY);
const prefill = params.get("prefill");
const loadError = params.get("error");

if (current && !params.has("switch") && !prefill && !loadError && loadInstances().some((saved) => saved.url === current)) {
    go(current);
} else {
    card.hidden = false;
    if (prefill) address.value = prefill;
    if (loadError) showError(loadError);
    render();
    if (!loadInstances().length) address.focus();
}
