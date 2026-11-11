import definePlugin from "@utils/types";
import { React } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import { MeowcordPaths, MeowcordSpinner } from "./art";
import { brandMessages } from "./messages";

const env = () => (window as any).GLOBAL_ENV ?? {};

const instanceName = () => String(env().INSTANCE_NAME || "Fosscord");

const imageUrl = (value: unknown) => (typeof value === "string" && /^(https?:\/\/|\/)/.test(value) ? value : "");

const helpUrl = () => (typeof env().HELP_URL === "string" && /^https?:\/\//.test(env().HELP_URL) ? env().HELP_URL : "");

const HELP_HOST = /^(?:https?:)?\/\/(?:(?:support(?:-dev|-apps)?|creator-support)\.discord\.com|dis\.gd)(?=[/?#:]|$)/i;

const isHelpUrl = (url: unknown) => typeof url === "string" && HELP_HOST.test(url);

const helpHref = (href: unknown) => {
    if (typeof href !== "string") return href;
    if (isHelpUrl(href)) return helpUrl() || false;
    if (helpUrl() && href.startsWith(helpUrl()) && /[?&]utm_source=discord/.test(href)) return helpUrl();
    return href;
};

const Icon = ({ size }: { size: number }) =>
    imageUrl(env().INSTANCE_ICON) ? (
        <img src={env().INSTANCE_ICON} width={size} height={size} alt="" style={{ objectFit: "contain" }} />
    ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <MeowcordPaths />
        </svg>
    );

let originalOpen: typeof window.open | null = null;

export default definePlugin({
    name: "FosscordBranding",
    description:
        "Uses this instance's name, logo, default avatars and help center instead of Discord's, in every translated string and on the sign-in pages, with feature access available to everyone.",
    authors: [FosscordAuthor],
    required: true,

    instanceName,
    helpUrl,
    isHelpUrl,
    brandMessages,

    helpHref,

    helpLink: (url: string) => (isHelpUrl(url) && helpUrl() ? helpUrl() : url),

    plainLink: (children: React.ReactNode, key: React.Key) => <React.Fragment key={key}>{children}</React.Fragment>,

    defaultAvatars: () => {
        const host = env().CDN_HOST || location.host;
        return Array.from({ length: 6 }, (_, i) => `${location.protocol}//${host}/embed/avatars/${i}.png`);
    },

    restoreFavicon() {
        for (const icon of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
            icon.removeAttribute("type");
            icon.href = "/favicon.svg";
        }
    },

    renderLogo: (fill: string, className?: string) =>
        imageUrl(env().INSTANCE_ICON) ? (
            <image className={className} href={env().INSTANCE_ICON} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
        ) : (
            <MeowcordPaths className={className} fill={fill} />
        ),

    renderSpinner: (props: { className?: string; onReady?: () => void; setRef?: (element: HTMLElement | null) => void }) => <MeowcordSpinner {...props} />,

    renderWordmark: (className: string) =>
        imageUrl(env().INSTANCE_LOGO) ? (
            <img className={className} src={env().INSTANCE_LOGO} alt={instanceName()} style={{ height: 24, width: "auto", objectFit: "contain" }} />
        ) : (
            <div
                className={className}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    height: 24,
                    color: "#fff",
                    fontFamily: 'var(--font-display, "gg sans", sans-serif)',
                    fontSize: 20,
                    fontWeight: 800,
                    lineHeight: "24px",
                }}
            >
                <Icon size={24} />
                {instanceName()}
            </div>
        ),

    start() {
        originalOpen = window.open;
        window.open = function (url?: string | URL, ...rest: any[]) {
            const href = helpHref(url instanceof URL ? url.href : url);
            return href === false ? null : originalOpen!.call(window, href as string | undefined, ...rest);
        } as typeof window.open;
    },

    stop() {
        if (originalOpen) window.open = originalOpen;
    },

    patches: [
        {
            find: "Error setting image. Message: ",
            replacement: {
                match: /(\i\.reset=function\(\)\{[^{}]*?)\i\.setIcon\(\i\)/,
                replace: "$1$self.restoreFavicon()",
            },
        },
        {
            find: "setAuthLogoHidden=",
            replacement: {
                match: /(\i\?null:)\(0,\i\.jsx\)\("img",\{className:(\i\.\i),src:\i,alt:""\}\)/,
                replace: "$1$self.renderWordmark($2)",
            },
        },
        {
            find: /JSON\.parse\('\{"(?:[\w+/]{6}":\[|COMMON_OPEN_DISCORD":")/,
            all: true,
            noWarn: true,
            replacement: {
                match: /JSON\.parse\(('[\s\S]*')\)\}$/,
                replace: "$self.brandMessages(JSON.parse($1))}",
            },
        },
        {
            find: 'link:"https://discord.com/accessibility"',
            replacement: {
                match: /link:"https:\/\/discord\.com\/accessibility"/,
                replace: "link:location.origin",
            },
        },
        {
            find: 'd:"M19.73 4.87a18.2 18.2 0 0 0-4.6-1.44',
            all: true,
            replacement: {
                match: /\(0,\i\.jsx\)\("path",\{fill:([^,{}]+),d:"M19\.73 4\.87a18\.2 18\.2 0 0 0-4\.6-1\.44[^"]*"(?:,className:(\i))?\}\)/,
                replace: "$self.renderLogo($1,$2)",
            },
        },
        {
            find: '"data-testid":"app-spinner"',
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,\{ref:(\i),onLoadedData:(\i),className:(\i),[^{}]*?"data-testid":"app-spinner",children:\i\},\i\)/,
                replace: "($self.renderSpinner({setRef:$1,onReady:$2,className:$3}))",
            },
        },
        {
            find: "DEFAULT_PROVISIONAL_AVATARS:[",
            replacement: [
                {
                    match: /DEFAULT_AVATARS:\[[^\]]*\]/,
                    replace: "DEFAULT_AVATARS:$self.defaultAvatars()",
                },
                {
                    match: /(BOT_AVATARS:\{clyde:)\i/,
                    replace: "$1$self.defaultAvatars()[0]",
                },
            ],
        },
        {
            find: /\.isPlatformEmbedded\?void 0:"/,
            replacement: {
                match: /\{base:\i\(\d+\)\.isPlatformEmbedded\?void 0:"[^"]*"\}|Vencord\.Plugins\.plugins(?:\.Title|\["Title"\])\.rootTitle/,
                replace: "{base:$self.instanceName()}",
            },
        },
        {
            find: /\[\i\.\i\.DISCORD\]:"[^"]*",\[\i\.\i\.STEAM\]:"Steam"/,
            replacement: {
                match: /(\[\i\.\i\.DISCORD\]:)"[^"]*"/,
                replace: "$1$self.instanceName()",
            },
        },
        {
            find: "otpauth://totp/",
            replacement: {
                match: /(arguments\[2\]:)"[^"]*"(?=;return`otpauth:\/\/totp\/)/,
                replace: "$1$self.instanceName()",
            },
        },
        {
            find: "HELP_CLICKED,{highlighted:",
            replacement: {
                match: /return(\(0,\i\.jsx\)\(\i\.Anchor,\{href:)\i\.\i,(target:"_blank",tabIndex:-1,children:\(0,\i\.jsx\)\(\i\.\i,\{color:)/,
                replace: "return !$self.helpUrl()?null:$1$self.helpUrl(),$2",
            },
        },
        {
            find: "getCommunityURL:",
            replacement: {
                match: /(function \i\(\i\)\{let (\i)=arguments\.length>1&&void 0!==arguments\[1\]\?arguments\[1\]:\i;return )(\2\+\i)\}/,
                replace: "$1$self.helpLink($3)}",
            },
        },
        {
            find: /useDefaultUnderlineStyles:\i=!0/,
            replacement: {
                match: /(let\{href:(\i),onClick:\i,className:\i,children:\i,[^}]*\}=\i;)/,
                replace: "$1$2=$self.helpHref($2);if($2===false)return null;",
            },
        },
        {
            find: "makeReactFormatter)({$i:",
            replacement: {
                match: /(\$link:\((\i),(\i),\i\)=>\{let\[(\i)\]=\i,.{0,80}?case"string":)/,
                replace: "$1$4=$self.helpHref($4);if($4===false)return $self.plainLink($2,$3);",
            },
        },
        {
            find: 'STATUS:"https://discordstatus.com"',
            replacement: {
                match: /STATUS:"https:\/\/discordstatus\.com"/,
                replace: 'STATUS:location.origin+"/status"',
            },
        },
        {
            find: ".TWITTER_SUPPORT,target:",
            replacement: {
                match: /\(0,\i\.jsxs\)\(\i\.Anchor,\{className:\i\.\i,href:\i\.\i\.TWITTER_SUPPORT,target:"_blank",children:\[\(0,\i\.jsx\)\(\i\.\i,\{[^{}]*\}\),\i\.intl\.string\(\i\.t\.\i\)\]\}\),/,
                replace: "",
            },
        },
        {
            find: "UOtD32,{guideURL:",
            replacement: {
                match: /(\i\.length>0)(\?\i\.intl\.format\(\i\.t\.UOtD32,\{guideURL:(\i)\}\))/,
                replace: "$1&&$self.helpHref($3)!==false$2",
            },
        },
        {
            find: ".NEW_TO_APPS,numItems:1",
            replacement: {
                match: /function \i\(\i\)\{(?=let\{padding:\i=!1\}=\i,\i=\i\.useCallback\(\(\)=>\{\(0,\i\.\i\)\(\i\.\i\.getAppsSupportURL\()/,
                replace: "$&if(!$self.helpUrl())return null;",
            },
        },
        {
            find: 'statusColor:"var(--border-subtle)"',
            replacement: {
                match: /src:null,(?=size:\i,status:\i\?\i\.\i\.ONLINE:void 0,statusColor:"var\(--border-subtle\)")/,
                replace: 'src:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",',
            },
        },
        {
            find: "isFake:!0",
            replacement: {
                match: /,\(0,\i\.jsx\)\(\i,\{text:\i,isFake:!0\}\)/,
                replace: "",
            },
        },
    ],
});
