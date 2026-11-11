import { getIntlMessage } from "@utils/discord";
import { findStoreLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const MobileWebSidebarStore = findStoreLazy("MobileWebSidebarStore") as { getIsOpen(): boolean };
const guardKey = "fosscordBackGuard";
const layerSelector = '[role="dialog"], [role="menu"], dialog[open]';

let guarded = false;
let swallow = 0;
let pending = 0;
let observer: MutationObserver | null = null;

const isPhone = () => document.documentElement.classList.contains("is-mobile");
const visible = (element: Element) => element.getClientRects().length > 0;
const topLayer = () => [...document.querySelectorAll<HTMLElement>(layerSelector)].filter(visible).at(-1);
const sidebarOpen = () => isPhone() && MobileWebSidebarStore.getIsOpen();
const layerOpen = () => isPhone() && (!!topLayer() || sidebarOpen());
const onGuard = () => history.state?.[guardKey] === true;

function pushGuard(afterClose = false) {
    if (guarded || (!afterClose && navigator.userActivation?.isActive === false)) return;
    history.pushState({ [guardKey]: true }, "", location.href);
    guarded = true;
}

function sync() {
    pending = 0;
    if (layerOpen()) return pushGuard();
    if (!guarded) return;
    guarded = false;
    if (!onGuard()) return;
    swallow++;
    history.back();
}

export function schedule() {
    if (!pending) pending = window.setTimeout(sync, 150);
}

function closeTopLayer() {
    const layer = topLayer();
    if (!layer) {
        if (sidebarOpen()) FluxDispatcher.dispatch({ type: "MOBILE_WEB_SIDEBAR_CLOSE" });
        return;
    }
    if (layer instanceof HTMLDialogElement) {
        if (layer.dispatchEvent(new Event("cancel", { cancelable: true }))) layer.close();
        return;
    }
    const back = [...layer.querySelectorAll<HTMLElement>(`[aria-label="${getIntlMessage("BACK")}"]`)].find(visible);
    if (back) return back.click();
    const target = document.activeElement && layer.contains(document.activeElement) ? document.activeElement : layer;
    for (const type of ["keydown", "keyup"]) {
        target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
    }
}

function onPopState(event: PopStateEvent) {
    if (!event.isTrusted) return;
    if (swallow > 0) {
        swallow--;
        event.stopImmediatePropagation();
        return;
    }
    if (onGuard()) {
        event.stopImmediatePropagation();
        history.back();
        return;
    }
    if (!guarded) return;
    guarded = false;
    event.stopImmediatePropagation();
    closeTopLayer();
    window.setTimeout(() => layerOpen() && pushGuard(true), 300);
}

export function startBackButton() {
    if (!/Android|iPhone|iPad|Mobi/i.test(navigator.userAgent)) return;
    window.addEventListener("popstate", onPopState, true);
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
}

export function stopBackButton() {
    window.removeEventListener("popstate", onPopState, true);
    observer?.disconnect();
    observer = null;
    if (pending) window.clearTimeout(pending);
    pending = 0;
}
