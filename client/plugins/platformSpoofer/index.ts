import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { PresenceStore, React, UserStore } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

type Platform = "desktop" | "web" | "mobile" | "vr" | "embedded";
type IdentifyProperties = {
    os?: string;
    browser?: string;
    device?: string;
    [key: string]: unknown;
};

// The server reads the platform from the browser and os sent on identify (getClientPlatform in src/util/util/Presence.ts):
// an Android or iOS os or browser is mobile, "Discord Client" is desktop, a browser with "Embedded" in it is a console,
// one with "VR" in it is VR and the rest is web. Consoles are what Discord calls the embedded platform.
const MOBILE_OS = /^(android|ios)$/i;

const settings = definePluginSettings({
    platform: {
        type: OptionType.SELECT,
        description: "The platform you appear online from",
        options: [
            { label: "Desktop", value: "desktop", default: true },
            { label: "Web", value: "web" },
            { label: "Mobile", value: "mobile" },
            { label: "VR", value: "vr" },
            { label: "Console", value: "embedded" },
        ],
        restartNeeded: true,
    },
});

function spoof(properties: IdentifyProperties = {}): IdentifyProperties {
    const platform = settings.store.platform as Platform;
    // Keep your real os for the platforms where it can't give you away as mobile, so Devices still says something true.
    const os = properties.os && !MOBILE_OS.test(properties.os) ? properties.os : "Windows";
    switch (platform) {
        case "mobile":
            return { ...properties, os: "Android", browser: "Discord Android", device: "Android" };
        case "vr":
            return { ...properties, os: "Meta Horizon OS", browser: "Discord VR", device: "Meta Quest" };
        case "embedded":
            return {
                ...properties,
                os: "Xbox",
                browser: "Discord Embedded",
                device: "Xbox Series X|S",
                browser_user_agent:
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edge/20.02",
            };
        case "web":
            return { ...properties, os, browser: "Chrome", device: "" };
        default:
            return { ...properties, os, browser: "Discord Client", device: "" };
    }
}

// Two places send IDENTIFY: Discord's fast-connect script, a separate bundle Vencord can't patch that identifies as soon as
// the page loads, and the gateway socket on every reconnect. Both go through WebSocket.send as JSON on the web client, so
// the properties are rewritten there. The plugin starts before fast-connect runs.
const originalSend = WebSocket.prototype.send;

function send(this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
    if (typeof data === "string" && data.startsWith('{"op":2,')) {
        try {
            const payload = JSON.parse(data);
            if (payload.d?.properties) {
                payload.d.properties = spoof(payload.d.properties);
                data = JSON.stringify(payload);
            }
        } catch {
            // not an identify we understand, send it as is
        }
    }
    return originalSend.call(this, data);
}

const isSelf = (userId: string) => userId != null && userId === UserStore.getCurrentUser()?.id;

type ClientStatus = Partial<Record<"desktop" | "web" | "mobile" | "vr" | "embedded", string>>;

// Discord only draws the phone and headset shapes while someone is online and falls back to the moon and minus for idle
// and do not disturb. These count idle and do not disturb as being on the platform too, so the shape stays and only the
// colour changes.
const isActive = (status?: string) => status === "online" || status === "idle" || status === "dnd";
const mobileActive = (cs?: ClientStatus | null) => !!cs && isActive(cs.mobile) && !isActive(cs.desktop) && !isActive(cs.vr) && !isActive(cs.embedded);
const consoleActive = (cs?: ClientStatus | null) => !!cs && isActive(cs.embedded) && !isActive(cs.desktop) && !isActive(cs.vr);
// Discord has no console shape. Consoles reuse everything the VR shape does (its size and the cutout in the avatar) and only
// swap the headset for a gamepad, so isVROnline says "console" for them, which still reads as true everywhere else.
const vrOrConsole = (cs?: ClientStatus | null): boolean | "console" => (!!cs && isActive(cs.vr)) || (consoleActive(cs) ? "console" : false);

const CONSOLE_MASK = "svg-mask-status-online-console";
// the gamepad from PlatformIndicators' console icon, cropped to its bounds the way the headset mask is
const GAMEPAD =
    "M3.06 20.4q-1.53 0-2.37-1.065T.06 16.74l1.26-9q.27-1.8 1.605-2.97T6.06 3.6h11.88q1.8 0 3.135 1.17t1.605 2.97l1.26 9q.21 1.53-.63 2.595T20.94 20.4q-.63 0-1.17-.225T18.78 19.5l-2.7-2.7H7.92l-2.7 2.7q-.45.45-.99.675t-1.17.225Zm14.94-7.2q.51 0 .855-.345T19.2 12q0-.51-.345-.855T18 10.8q-.51 0-.855.345T16.8 12q0 .51.345 .855T18 13.2Zm-2.4-3.6q.51 0 .855-.345T16.8 8.4q0-.51-.345-.855T15.6 7.2q-.51 0-.855.345T14.4 8.4q0 .51.345 .855T15.6 9.6ZM6.9 13.2h1.8v-2.1h2.1v-1.8h-2.1v-2.1h-1.8v2.1h-2.1v1.8h2.1v2.1Z";

const consoleMask = () =>
    React.createElement(
        "mask",
        {
            key: CONSOLE_MASK,
            id: CONSOLE_MASK,
            maskContentUnits: "objectBoundingBox",
            viewBox: "0 0 1 1",
        },
        React.createElement("svg", { viewBox: "0 3.6 24 16.8", width: "1", height: "1", preserveAspectRatio: "none" }, React.createElement("path", { fill: "white", d: GAMEPAD })),
    );
// The status that decides the shape. The colour is still worked out from the real status.
const shapeStatus = (status: string, isMobile?: boolean, isVR?: boolean) => ((isMobile || isVR) && (status === "idle" || status === "dnd") ? "online" : status);

// The presence store skips updates about yourself, so your own avatar never learns your platform. This answers for you
// with the spoofed one, so your status takes the same shape everyone else sees.
function selfClientStatus(): ClientStatus {
    const status = PresenceStore.getStatus(UserStore.getCurrentUser().id);
    return status && status !== "offline" && status !== "invisible" ? { [settings.store.platform]: status } : {};
}

const selfMobile = () => mobileActive(selfClientStatus());
const selfVROrConsole = () => vrOrConsole(selfClientStatus());

export default definePlugin({
    name: "PlatformSpoofer",
    description: "Spoof what platform or device you're on",
    authors: [FosscordAuthor],
    settings,
    startAt: StartAt.Init,

    start() {
        WebSocket.prototype.send = send;
    },

    stop() {
        if (WebSocket.prototype.send === send) WebSocket.prototype.send = originalSend;
    },

    isSelf,
    isActive,
    mobileActive,
    vrOrConsole,
    shapeStatus,
    selfMobile,
    selfVROrConsole,
    selfClientStatus,
    consoleMask,

    patches: [
        {
            find: "isMobileOnline(e){let t=",
            replacement: [
                {
                    // getClientStatus already answers for you, so both of these work for your own avatar too
                    match: /isMobileOnline\((\i)\)\{/,
                    replace: "$&return $self.mobileActive(this.getClientStatus($1));",
                },
                {
                    match: /isVROnline\((\i)\)\{/,
                    replace: "$&return $self.vrOrConsole(this.getClientStatus($1));",
                },
                {
                    match: /getClientStatus\((\i)\)\{return /,
                    replace: "$&$self.isSelf($1)?$self.selfClientStatus():",
                },
            ],
        },
        {
            // the avatar's status, which picks its colour from the status and then its shape
            find: ".AVATAR_STATUS_MOBILE_16;",
            replacement: {
                match: /(\{isMobile:(\i)=!1,isTyping:\i=!1,isVR:(\i)=!1\}=\i,.{0,60}?\i=\(0,\i\.\i\)\((\i),\i\)),/,
                replace: "$1,fcShape=($4=$self.shapeStatus($4,$2,$3)),",
            },
        },
        {
            // the bare status dot, and the status shape every avatar asks for
            find: ".Masks.STATUS_ONLINE_MOBILE",
            replacement: [
                {
                    match: /(\i)=(\i)===\i\.\i\.ONLINE&&(\i),(\i)=\2===\i\.\i\.ONLINE&&(\i),(\i=\i\(\2,\i\));/,
                    replace: "$1=$self.isActive($2)&&$3,$4=$self.isActive($2)&&$5,$6;$2=$self.shapeStatus($2,$1,$4);",
                },
                {
                    match: /if\((\i)\)return (\i\.\i\.Masks)\.STATUS_ONLINE_VR;/,
                    replace: 'if($1)return $1==="console"?"svg-mask-status-online-console":$2.STATUS_ONLINE_VR;',
                },
            ],
        },
        {
            // the shared mask library only draws the masks something asked for
            find: 'has("svg-mask-status-online-vr")',
            replacement: {
                match: /(\i)\.has\("svg-mask-status-online-vr"\)&&/,
                replace: '$1.has("svg-mask-status-online-console")&&$self.consoleMask(),$&',
            },
        },
        {
            // the avatar in the account panel, which never asks for a platform; a lazy chunk carries a second copy of it
            find: "SHOW_ACCOUNT_PROFILE_POPOUT,t),()=>",
            all: true,
            replacement: {
                match: /status:\i\?\i\.\i\.STREAMING:\i,(?=isSpeaking:\i,voiceDb:)/,
                replace: "$&isMobile:$self.selfMobile(),isVR:$self.selfVROrConsole(),",
            },
        },
    ],
});
