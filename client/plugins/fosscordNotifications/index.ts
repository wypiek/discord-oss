import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import { notificationClass } from "./serviceWorker";

export default definePlugin({
    name: "FosscordNotifications",
    description:
        "Asks the browser for notification permission when desktop notifications are turned on, and shows them through a service worker in Android browsers, which refuse to construct a Notification.",
    authors: [FosscordAuthor],
    required: true,

    requestPermission(desktopType: string) {
        if (desktopType !== "ALL" || !("Notification" in window) || Notification.permission !== "default") return;
        Notification.requestPermission().catch(() => {});
    },

    notificationClass,

    patches: [
        {
            find: '"NOTIFICATIONS_CLEAR"',
            replacement: {
                match: /(?<=let \i=)window\.Notification(?=;)/,
                replace: "$self.notificationClass()",
            },
        },
        {
            find: 'type:"NOTIFICATIONS_SET_DESKTOP_TYPE",desktopType:',
            replacement: {
                match: /setDesktopType\((\i)\)\{/,
                replace: "$&$self.requestPermission($1);",
            },
        },
    ],
});
