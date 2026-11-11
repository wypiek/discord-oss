import definePlugin, { StartAt } from "@utils/types";
import { Avatar, RestAPI, Slider, Text, UserStore, useState, useStateFromStores } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import { Button, SettingsSection } from "../fosscordCore/ui";
import managedStyle from "./style.css?managed";

type RadiusCarrier = { id?: string; avatarCornerRadius?: unknown; avatar_corner_radius?: unknown } | null | undefined;
type Jsx = { jsx: (type: string, props: Record<string, unknown>) => unknown };

const CIRCLE = 50;
const FRAGMENT = "#meowcord-avatar-radius-";
const SVG = "http://www.w3.org/2000/svg";
const PRESETS = [
    { label: "Circle", value: 50 },
    { label: "Rounded", value: 30 },
    { label: "Soft square", value: 16 },
    { label: "Square", value: 0 },
];

const isRadius = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= CIRCLE;
const shaped = (value: unknown) => (isRadius(value) && value !== CIRCLE ? value : null);

function radiusOf(user: RadiusCarrier) {
    if (!user?.id) return null;
    const stored = UserStore.getUser(user.id) as RadiusCarrier;
    if (stored) return shaped(stored.avatarCornerRadius);
    return shaped(user.avatarCornerRadius ?? user.avatar_corner_radius);
}

function withRadius(url: unknown, radius: number | null) {
    if (typeof url !== "string") return url;
    const base = url.split(FRAGMENT)[0];
    return radius === null ? base : `${base}${FRAGMENT}${radius}`;
}

function radiusInSource(src: unknown) {
    if (typeof src !== "string") return null;
    const at = src.lastIndexOf(FRAGMENT);
    return at < 0 ? null : shaped(Number(src.slice(at + FRAGMENT.length)));
}

const created = new Set<string>();
let library: SVGSVGElement | null = null;

function buildMask(original: string, id: string, radius: number, attempt = 0) {
    if (created.has(id)) return;
    const source = document.getElementById(original);
    if (!source) {
        if (attempt < 120) requestAnimationFrame(() => buildMask(original, id, radius, attempt + 1));
        return;
    }
    if (!library) {
        library = document.createElementNS(SVG, "svg");
        library.setAttribute("aria-hidden", "true");
        library.setAttribute("width", "0");
        library.setAttribute("height", "0");
        library.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
        document.body.append(library);
    }
    const mask = source.cloneNode(true) as Element;
    mask.id = id;
    const shape = document.createElementNS(SVG, "rect");
    for (const [name, value] of Object.entries({ x: "0", y: "0", width: "1", height: "1", rx: `${radius / 100}`, ry: `${radius / 100}`, fill: "white" }))
        shape.setAttribute(name, value);
    const fill = [...mask.children].find((child) => child.getAttribute("fill") === "white");
    if (fill) fill.replaceWith(shape);
    else mask.prepend(shape);
    library.append(mask);
    created.add(id);
}

function shapeRules() {
    const rules: string[] = [];
    for (let radius = 0; radius < CIRCLE; radius++) {
        const end = `${FRAGMENT}${radius}`;
        rules.push(`img[src$="${end}"],[style*='${end}"']{border-radius:${radius}%!important}`);
    }
    return rules.join("\n");
}

let rulesElement: HTMLStyleElement | null = null;

type Cutout = { align?: string; insetStart?: number; insetBottom?: number; radius?: number; meowcordCorner?: number };

const HOLE_CANVAS = 6000;

function cutoutMask(cutout: Cutout | null | undefined) {
    const corner = cutout?.meowcordCorner;
    const radius = cutout?.radius;
    if (typeof corner !== "number" || typeof radius !== "number" || radius <= 0) return {};
    const center = HOLE_CANVAS / 2;
    const start = center - radius;
    const end = center + radius;
    const k = Math.min(corner, radius);
    const hole = `M${start + k} ${start}H${end - k}A${k} ${k} 0 0 1 ${end} ${start + k}V${end - k}A${k} ${k} 0 0 1 ${end - k} ${end}H${start + k}A${k} ${k} 0 0 1 ${start} ${end - k}V${start + k}A${k} ${k} 0 0 1 ${start + k} ${start}Z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${HOLE_CANVAS}" height="${HOLE_CANVAS}"><path fill-rule="evenodd" d="M0 0H${HOLE_CANVAS}V${HOLE_CANVAS}H0Z${hole}"/></svg>`;
    const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    const x = cutout?.align === "center" ? "center" : `left ${(cutout?.insetStart ?? 0) + radius - center}px`;
    const position = `${x} bottom ${(cutout?.insetBottom ?? 0) - center}px`;
    return {
        maskImage: image,
        WebkitMaskImage: image,
        maskPosition: position,
        WebkitMaskPosition: position,
        maskSize: `${HOLE_CANVAS}px ${HOLE_CANVAS}px`,
        WebkitMaskSize: `${HOLE_CANVAS}px ${HOLE_CANVAS}px`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
    };
}

function AvatarShapeSetting() {
    const user = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const saved = shaped((user as RadiusCarrier)?.avatarCornerRadius) ?? CIRCLE;
    const [value, setValue] = useState(saved);
    const [sliderKey, setSliderKey] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    if (!user) return null;
    const preview = withRadius(user.getAvatarURL(null, 80), shaped(value)) as string;
    const choose = (next: number) => {
        setValue(next);
        setMessage("");
        setSliderKey((key) => key + 1);
    };
    const save = async () => {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            await RestAPI.patch({ url: "/users/@me", body: { avatar_corner_radius: value === CIRCLE ? null : value } });
            setMessage(value === CIRCLE ? "Your avatar is a circle again." : "Avatar shape saved.");
        } catch {
            setError("Could not save your avatar shape. Try again.");
        } finally {
            setBusy(false);
        }
    };
    return (
        <SettingsSection
            className="fosscord-avatar-shape"
            title="Avatar shape"
            description="Round the corners of your avatar anywhere from a circle to a square. Everyone sees this shape wherever your avatar shows."
        >
            <div className="fosscord-avatar-shape-body">
                <div className="fosscord-avatar-shape-preview" aria-label={`Preview with ${value}% corner radius`} role="img">
                    <Avatar src={preview} size="SIZE_80" status="online" aria-hidden={true} />
                    <Avatar src={preview} size="SIZE_40" status="idle" aria-hidden={true} />
                    <img src={preview} alt="" width={32} height={32} className="fosscord-avatar-shape-message" />
                </div>
                <div className="fosscord-avatar-shape-controls">
                    <div className="fosscord-avatar-shape-presets" role="group" aria-label="Shape presets">
                        {PRESETS.map((preset) => (
                            <button
                                key={preset.value}
                                type="button"
                                className="fosscord-avatar-shape-preset"
                                aria-pressed={value === preset.value}
                                disabled={busy}
                                onClick={() => choose(preset.value)}
                            >
                                <span className="fosscord-avatar-shape-swatch" style={{ borderRadius: `${preset.value}%` }} aria-hidden="true" />
                                <Text variant="text-sm/medium">{preset.label}</Text>
                            </button>
                        ))}
                    </div>
                    <div className="fosscord-avatar-shape-slider">
                        <label htmlFor="fosscord-avatar-shape-radius">
                            <Text variant="text-sm/medium">Corner radius</Text>
                        </label>
                        <Slider
                            key={sliderKey}
                            initialValue={value}
                            minValue={0}
                            maxValue={CIRCLE}
                            markers={[0, 10, 20, 30, 40, 50]}
                            stickToMarkers={false}
                            keyboardStep={1}
                            disabled={busy}
                            onMarkerRender={(marker: number) => `${marker}%`}
                            onValueRender={(current: number) => `${Math.round(current)}%`}
                            getAriaValueText={(current: number) => `${Math.round(current)} percent`}
                            onValueChange={(current: number) => {
                                setValue(Math.round(current));
                                setMessage("");
                            }}
                        />
                    </div>
                    <div className="fosscord-avatar-shape-actions">
                        <Button disabled={busy} onClick={save}>
                            {busy ? "Saving…" : "Save avatar shape"}
                        </Button>
                        <Text variant="text-sm/normal" color="text-muted" className="fosscord-avatar-shape-value">
                            {value === CIRCLE ? "Circle" : `${value}% corners`}
                        </Text>
                    </div>
                </div>
            </div>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
        </SettingsSection>
    );
}

export default definePlugin({
    name: "FosscordAvatarShape",
    description: "Lets people round their avatar from a circle to a square and draws every avatar in the shape its owner picked.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
    startAt: StartAt.Init,
    start() {
        rulesElement = document.createElement("style");
        rulesElement.id = "fosscord-avatar-shape-rules";
        rulesElement.textContent = shapeRules();
        document.head.append(rulesElement);
    },
    stop() {
        rulesElement?.remove();
        rulesElement = null;
    },
    tagUserAvatar: (url: unknown, user: RadiusCarrier) => withRadius(url, radiusOf(user)),
    tagMemberAvatar: (url: unknown, userId: string) => withRadius(url, radiusOf({ id: userId })),
    radiusFrom: (raw: RadiusCarrier) => {
        if (!raw) return null;
        if (raw.avatar_corner_radius !== undefined) return isRadius(raw.avatar_corner_radius) ? raw.avatar_corner_radius : null;
        return isRadius(raw.avatarCornerRadius) ? raw.avatarCornerRadius : null;
    },
    mask(original: string, src: unknown) {
        const radius = radiusInSource(src);
        if (radius === null || typeof original !== "string") return original;
        const id = `${original}-meowcord-${radius}`;
        if (!created.has(id)) queueMicrotask(() => buildMask(original, id, radius));
        return id;
    },
    maskShape(runtime: Jsx, original: unknown, size: number, src: unknown) {
        const radius = radiusInSource(src);
        if (radius === null) return original;
        const corner = (size * radius) / 100;
        return runtime.jsx("rect", { x: 0, y: 0, width: size, height: size, rx: corner, ry: corner, fill: "white" });
    },
    cutout(cutout: Cutout, user: RadiusCarrier, avatarSize: number) {
        const radius = radiusOf(user);
        if (radius === null || typeof cutout?.radius !== "number" || !(avatarSize > 0)) return cutout;
        const ring = Math.max(0, cutout.radius - avatarSize / 2);
        return { ...cutout, meowcordCorner: (avatarSize * radius) / 100 + ring };
    },
    cutoutMask,
    renderSetting: () => <AvatarShapeSetting key="fosscord-avatar-shape" />,
    patches: [
        {
            find: "has_bounced_email??",
            replacement: {
                match: /this\.displayNameStyles=\i\.displayNameStyles\?\?/,
                replace: "this.avatarCornerRadius=this.avatar_corner_radius=$self.radiusFrom(arguments[0]),$&",
            },
        },
        {
            find: "getGuildMemberAvatarURLSimple:",
            replacement: [
                {
                    match: /(function \i\((\i)\)\{let \i=arguments\.length>1&&void 0!==arguments\[1\]&&arguments\[1\].{0,400}?return )(\i\(\2,\i,\i,\i,\i\)\?\?\i\(\2\.id,\2\.discriminator,\2\.isProvisional,\i\))\}/,
                    replace: "$1$self.tagUserAvatar($3,$2)}",
                },
                {
                    match: /(function \i\(\i\)\{let \i,\{guildId:\i,userId:(\i),avatar:\i,canAnimate:.{0,500}?)return(.{0,120}?\i\+=`\?\$\{\i\.stringify\(\i\)\}`)\}/,
                    replace: "$1return $self.tagMemberAvatar(($3),$2)}",
                },
            ],
        },
        {
            find: "getMaskId(): Unsupported type",
            replacement: [
                {
                    match: /mask:`url\(#\$\{(\i)\}\)`,children:\(0,(\i)\.jsx\)\((\i),\{ref:(\i),src:(\i),/,
                    replace: "mask:`url(#${$self.mask($1,$5)})`,children:(0,$2.jsx)($3,{ref:$4,src:$5,",
                },
                {
                    match: /\(0,(\i)\.jsx\)\("circle",\{cx:(\i)\/2,cy:\i\/2,r:\i\/2,fill:"white"\}\)(?=.{0,400}?\{src:(\i),isSpeaking:)/,
                    replace: '$self.maskShape($1,(0,$1.jsx)("circle",{cx:$2/2,cy:$2/2,r:$2/2,fill:"white"}),$2,$3)',
                },
            ],
        },
        {
            find: /align:"start",insetStart:\i-\i,insetBottom:\i\+\i,radius:/,
            all: true,
            replacement: {
                match: /(?<=(\i)\.getAvatarURL\(\i,(\(0,\i\.\i\))\(\i\)\).{0,200}?)\{align:"start",insetStart:[^{}]+?,radius:\(0,\i\.\i\)\((\i)\)\}/,
                replace: "$self.cutout($&,$1,$2($3))",
            },
        },
        {
            find: '"--custom-cutout-radius":',
            replacement: {
                match: /(?<=cutout:(\i),.{0,900}?backgroundImage:.{0,80}?,backgroundColor:\i)(?=\})/,
                replace: ",...$self.cutoutMask($1)",
            },
        },
        {
            find: "DefaultCustomizationSections: user cannot be undefined",
            replacement: {
                match: /forcedDivider:!0\},"avatar"\),/,
                replace: "$&$self.renderSetting(),",
            },
        },
    ],
});
