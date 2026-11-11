import { updateMessage } from "@api/MessageUpdater";
import SettingsPlugin from "@plugins/_core/settings";
import definePlugin, { IconProps } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { ChannelStore, MessageStore, showToast, useEffect, useRef, useState } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

interface E2eeBridge {
    isEncrypted?: (channelId: string) => boolean;
    beforeSend?: (channelId: string) => boolean | Promise<boolean>;
    mountSettings?: (container: HTMLElement) => () => void;
    updateMessage?: typeof updateMessage;
}

type LayoutNode = ReturnType<typeof SettingsPlugin.buildEntry> & { fosscordE2ee?: boolean };

interface SystemMessageProps {
    message: {
        id: string;
        channel_id: string;
        author?: { username?: string; globalName?: string | null; global_name?: string | null };
        timestamp?: unknown;
    };
    compact?: boolean;
}

const ENTRY_KEY = "fosscord_encryption_sidebar_item";
const E2EE_ENABLED_TYPE = 1000;

const SystemMessage = findComponentByCodeLazy("iconContainerClassName", "timestampFormat");
const LOCK_PATH = "M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z";

const LABELS: Record<string, [title: string, unavailable: string]> = {
    en: ["Encryption", "Not available in encrypted conversations"],
    de: ["Verschlüsselung", "In verschlüsselten Unterhaltungen nicht verfügbar"],
    fr: ["Chiffrement", "Indisponible dans les conversations chiffrées"],
    ja: ["暗号化", "暗号化された会話では使用できません"],
    pl: ["Szyfrowanie", "Niedostępne w szyfrowanych rozmowach"],
    "zh-CN": ["加密", "在加密对话中不可用"],
};

const labels = () => {
    const lang = document.documentElement.lang;
    return LABELS[lang] ?? LABELS[lang.split("-")[0]] ?? LABELS.en;
};

const bridge = () => (window as unknown as { __fosscordE2ee?: E2eeBridge }).__fosscordE2ee;

const privateChannel = (channelId: string) => {
    const channel = ChannelStore.getChannel(channelId);
    return channel ? channel.type === 1 || channel.type === 3 : location.pathname === `/channels/@me/${channelId}`;
};
const guardSend = async (channelId: string) => {
    if (!bridge()?.beforeSend && privateChannel(channelId)) {
        const deadline = Date.now() + 20000;
        while (!bridge()?.beforeSend && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
        if (!bridge()?.beforeSend) {
            showToast("Private chat is still preparing. Try sending again.", "failure");
            return true;
        }
    }
    return !!(await bridge()?.beforeSend?.(channelId));
};

const exposeUpdater = () => {
    const target = bridge();
    if (target) target.updateMessage = updateMessage;
    return !!target;
};

const EncryptionIcon = ({ width = 20, height = 20, className }: IconProps) => (
    <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d={LOCK_PATH} />
    </svg>
);

const hadEarlierMessages = (message: SystemMessageProps["message"]) => {
    const messages = MessageStore.getMessages(message.channel_id);
    const index = messages?._array?.findIndex((m) => m.id === message.id) ?? -1;
    return index !== 0 || !!messages?.hasMoreBefore;
};

function EncryptionEnabledMessage({ message, compact }: SystemMessageProps) {
    const author = message.author;
    const name = author?.globalName || author?.global_name || author?.username || "Someone";
    return (
        <SystemMessage iconNode={<EncryptionIcon width={16} height={16} />} timestamp={message.timestamp} compact={compact}>
            <span style={{ fontWeight: 500, color: "var(--text-strong, var(--header-primary))" }}>{name}</span> turned on end-to-end encryption.
            {hadEarlierMessages(message) ? " Messages sent before this weren't encrypted." : null}
        </SystemMessage>
    );
}

function EncryptionPage() {
    const ref = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(() => !!bridge()?.mountSettings);
    useEffect(() => {
        if (ready) return;
        const timer = setInterval(() => bridge()?.mountSettings && setReady(true), 250);
        return () => clearInterval(timer);
    }, [ready]);
    useEffect(() => {
        const mount = bridge()?.mountSettings;
        if (!ready || !ref.current || !mount) return;
        return mount(ref.current);
    }, [ready]);
    return <div ref={ref} />;
}

const insertEntry = (items: LayoutNode[]) => {
    if (!Array.isArray(items) || items.some((item) => item?.key === ENTRY_KEY)) return items;
    const [title] = labels();
    const entry = SettingsPlugin.buildEntry({
        key: ENTRY_KEY,
        title,
        panelTitle: title,
        Component: EncryptionPage,
        Icon: EncryptionIcon,
    });
    const anchor = items.findIndex((item) => item?.key === "data_and_privacy_sidebar_item");
    items.splice(anchor === -1 ? items.length : anchor + 1, 0, entry);
    return items;
};

let originalBuildLayout: typeof SettingsPlugin.buildLayout | null = null;

export default definePlugin({
    name: "FosscordE2ee",
    description: "Connects end-to-end encrypted DMs to the composer and adds the Encryption settings page.",
    authors: [FosscordAuthor],
    required: true,
    dependencies: ["MessageEventsAPI"],

    patches: [
        {
            find: "unknown message type ",
            replacement: {
                match: /\{type:(\i)\}=(\i),(\i)=(\i)\[\1\];/,
                replace: "{type:$1}=$2,$3=$4[$1]??$self.systemMessage($1);",
            },
        },
        {
            find: "FORWARDABLE.has(",
            replacement: {
                match: /if\(null==(\i)\|\|!\((\i)\.state!==/,
                replace: "if(null==$1||$self.isEncrypted($1.channel_id)||!($2.state!==",
            },
        },
        {
            find: 'navId:"channel-attach"',
            replacement: {
                match: /id:"(clips|poll)",/g,
                replace: 'id:"$1",disabled:$self.inEncryptedChannel(),subtext:$self.inEncryptedChannel()?$self.unavailableLabel():void 0,',
            },
        },
    ],

    systemMessage(type: number) {
        return type === E2EE_ENABLED_TYPE ? EncryptionEnabledMessage : undefined;
    },

    isEncrypted(channelId?: string) {
        return !!channelId && !!bridge()?.isEncrypted?.(channelId);
    },

    unavailableLabel() {
        return labels()[1];
    },

    inEncryptedChannel() {
        return this.isEncrypted(/^\/channels\/@me\/(\d+)/.exec(location.pathname)?.[1]);
    },

    async onBeforeMessageSend(channelId) {
        if (await guardSend(channelId)) return { cancel: true };
    },

    async onBeforeMessageEdit(channelId) {
        if (await guardSend(channelId)) return { cancel: true };
    },

    start() {
        if (!exposeUpdater()) {
            const timer = setInterval(() => exposeUpdater() && clearInterval(timer), 250);
            setTimeout(() => clearInterval(timer), 30000);
        }
        originalBuildLayout = SettingsPlugin.buildLayout;
        const original = originalBuildLayout;
        SettingsPlugin.buildLayout = function (builder) {
            const layout: LayoutNode[] = original.call(this, builder);
            if (builder.key === "user_section") return insertEntry(layout);
            if (builder.key !== "$Root" || !Array.isArray(layout)) return layout;
            const user = layout.find((node) => node?.key === "user_section");
            if (user?.buildLayout && !user.fosscordE2ee) {
                const build = user.buildLayout;
                user.buildLayout = () => insertEntry(build());
                user.fosscordE2ee = true;
            }
            return layout;
        };
    },

    stop() {
        const target = bridge();
        if (target) delete target.updateMessage;
        if (originalBuildLayout) SettingsPlugin.buildLayout = originalBuildLayout;
        originalBuildLayout = null;
    },
});
