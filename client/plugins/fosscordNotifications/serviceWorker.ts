import { NavigationRouter } from "@webpack/common";

type ClickHandler = (event: Event) => void;

const scope = "/notifications-sw/";
const live = new Map<string, ServiceWorkerNotification>();
let counter = 0;

const activeRegistration = async () => {
    const existing = await navigator.serviceWorker.getRegistration(scope);
    const registration = existing?.scope.endsWith(scope) ? existing : await navigator.serviceWorker.register("/notifications-sw.js", { scope });
    if (registration.active) return registration;
    const worker = registration.installing ?? registration.waiting;
    await new Promise<void>((resolve) => worker?.addEventListener("statechange", () => worker.state === "activated" && resolve()));
    return registration;
};

const listen = () => {
    navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type !== "fosscord-notification-click") return;
        const notification = live.get(event.data.id);
        if (!notification) {
            if (typeof event.data.path === "string" && event.data.path.startsWith("/channels/")) NavigationRouter.transitionTo(event.data.path);
            return;
        }
        live.delete(notification.id);
        notification.onclick?.(new Event("click"));
    });
};

export class ServiceWorkerNotification {
    static get permission() {
        return Notification.permission;
    }

    static requestPermission(callback?: NotificationPermissionCallback) {
        return Notification.requestPermission(callback);
    }

    id = `fosscord-${Date.now()}-${counter++}`;
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    onshow: (() => void) | null = null;
    onclick: ClickHandler | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;

    constructor(title: string, options: NotificationOptions = {}) {
        this.title = title;
        this.body = options.body ?? "";
        this.icon = options.icon;
        this.tag = options.tag || this.id;
        live.set(this.id, this);
        activeRegistration()
            .then((registration) => registration.showNotification(title, { ...options, tag: this.tag, data: { id: this.id, url: location.pathname } }))
            .then(() => this.onshow?.())
            .catch((error) => {
                live.delete(this.id);
                this.onerror?.(error);
            });
    }

    close() {
        if (!live.delete(this.id)) return;
        activeRegistration()
            .then((registration) => registration.getNotifications({ tag: this.tag }))
            .then((notifications) => notifications.filter((notification) => notification.data?.id === this.id).forEach((notification) => notification.close()))
            .catch(() => {});
        this.onclose?.();
    }
}

export function notificationClass() {
    if (!/Android/i.test(navigator.userAgent) || !("userAgentData" in navigator) || !("serviceWorker" in navigator) || !window.isSecureContext) return window.Notification;
    listen();
    return ServiceWorkerNotification;
}
