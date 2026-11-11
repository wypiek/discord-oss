import definePlugin from "@utils/types";
import { FosscordAuthor } from "../fosscordCore/shared";
export default definePlugin({
    name: "FosscordNoPopout",
    description: "Stops the client from opening a blank /popout tab or window on its own.",
    authors: [FosscordAuthor],
    required: true,
    start() {
        const open = window.open;
        window.open = function (this: Window, url?: string | URL, ...rest: unknown[]) {
            try {
                if (url && new URL(String(url), location.href).pathname === "/popout") return null;
            } catch {}
            return (open as (...args: unknown[]) => Window | null).call(this, url, ...rest);
        } as typeof window.open;
    },
});
