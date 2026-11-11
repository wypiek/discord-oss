import definePlugin from "@utils/types";
import { filters, mapMangledModuleLazy } from "@webpack";
import { FosscordAuthor } from "../fosscordCore/shared";

const path = "/settings/account/account-standing";
const marker = "https://meowcord.invalid" + path;
const Router = mapMangledModuleLazy("transitionTo - Transitioning to", {
    replaceWith: filters.byCode("Replacing route with"),
});
let observer: MutationObserver | undefined;
const matches = (href: string) => href === marker || href === location.origin + path;
const selector = `a[href="${marker}"]`;
const localize = (root: ParentNode = document) => {
    if (root instanceof Element && root.matches(selector)) root.setAttribute("href", location.origin + path);
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>(selector)) anchor.href = location.origin + path;
};
const click = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || !matches(anchor.href) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    Router.replaceWith(path);
};
export default definePlugin({
    name: "FosscordSafetyCTAs",
    description: "Opens the instance Account Standing page from encrypted safety notices.",
    authors: [FosscordAuthor],
    required: true,
    start() {
        localize();
        observer = new MutationObserver((records) => {
            for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) localize(node);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("click", click, true);
    },
    stop() {
        observer?.disconnect();
        observer = undefined;
        document.removeEventListener("click", click, true);
    },
});
