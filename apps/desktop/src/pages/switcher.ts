const list = document.getElementById("instances") as HTMLUListElement;
const form = document.getElementById("connect") as HTMLFormElement;
const address = document.getElementById("address") as HTMLInputElement;
const submit = document.getElementById("submit") as HTMLButtonElement;
const errorText = document.getElementById("error") as HTMLParagraphElement;

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

async function openSaved(url: string) {
    busy(true);
    showError(null);
    const result = await window.discordOss.openInstance(url);
    if (result.error) {
        busy(false);
        showError(result.error);
    }
}

function render(instances: SavedInstance[], current: string | null) {
    list.replaceChildren();
    list.hidden = instances.length === 0;
    for (const instance of [...instances].sort((a, b) => b.lastUsed - a.lastUsed)) {
        const item = document.createElement("li");
        item.className = instance.url === current ? "instance current" : "instance";

        const openButton = document.createElement("button");
        openButton.className = "open";
        openButton.type = "button";
        openButton.addEventListener("click", () => openSaved(instance.url));

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
        remove.className = "remove";
        remove.type = "button";
        remove.title = `Remove ${instance.name}`;
        remove.setAttribute("aria-label", `Remove ${instance.name}`);
        remove.textContent = "×";
        remove.addEventListener("click", async () => {
            const state = await window.discordOss.removeInstance(instance.url);
            if (state) render(state.instances, state.current);
        });

        item.append(openButton, remove);
        list.append(item);
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    openSaved(address.value);
});

window.discordOss.onError((message) => showError(message));

const prefill = new URLSearchParams(location.search).get("prefill");
if (prefill) address.value = prefill;

window.discordOss.listInstances().then((state) => {
    if (state) render(state.instances, state.current);
    if (!state?.instances.length || prefill) address.focus();
});
