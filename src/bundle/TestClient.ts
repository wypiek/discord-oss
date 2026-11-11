import express, { Application, Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { ClientAssetCompression, clientAssetVersion } from "./ClientAssetCompression";
import {
    appMetaTags,
    baseGlobalEnv,
    clientEnvScript,
    clientRootsFromEntry,
    escapeTitle,
    finishClientHtml,
    GLOBAL_ENV_SCRIPT,
    prepareClientHtml,
    vencordScriptTag,
} from "./ClientHtml";
import { BRANDED_CLIENT_ASSETS } from "../util/util/BrandMarkup";
import { sendMobileBundle } from "./MobileBundle";
import { compressedStatic } from "../util/util/CompressedStatic";
import { inviteCodeFromPath, invitePage } from "@spacebar/api/util";
import { instanceId } from "@spacebar/api/util/utility/federation";
import { User } from "@spacebar/database";
import { IsNull } from "typeorm";
import {
    appIconPng,
    appIconUrl,
    appManifest,
    brandImageUrls,
    brandPage,
    escapeHtml,
    instanceName,
    Config,
    DEFAULT_ICON_FILE,
    DEFAULT_FAVICON_FILE,
    helpUrl,
    instanceIcon,
    instancePage,
    openGraphTags,
    requestOrigin,
    instanceIconDataUri,
    sendBrandImage,
} from "@spacebar/util";

const ASSET_FOLDER_PATH = path.join(__dirname, "..", "..", "assets");
const CACHE_PATH = path.join(ASSET_FOLDER_PATH, "cache");
const COMPRESSED_PATH = process.env.CLIENT_COMPRESSED_PATH ? path.resolve(process.env.CLIENT_COMPRESSED_PATH) : path.join(ASSET_FOLDER_PATH, "cache_compressed");
const PATCH_PATH = path.join(ASSET_FOLDER_PATH, "client_patches");
const VENCORD_PATH = path.join(ASSET_FOLDER_PATH, "vencord");
const VENCORD_SCRIPT = path.join(VENCORD_PATH, "vencord.js");
const UPSTREAM = "https://discord.com";
const DEVELOPMENT = process.env.NODE_ENV === "development";
const HASHED = /(?:^|[.-])[0-9a-f]{8,32}\.\w+$/;
const COMPRESSIBLE = /\.(js|css|json|svg|wasm)$/;
const PRECOMPRESSED: Record<string, string> = { br: "br", gzip: "gz" };

const acceptedEncodings = (header = "") => {
    const weights = new Map<string, number>();
    for (const part of header.toLowerCase().split(",")) {
        const [name, ...params] = part.split(";").map((x) => x.trim());
        const q = params.find((x) => x.startsWith("q="));
        if (name) weights.set(name, q ? Number(q.slice(2)) : 1);
    }
    const weight = (encoding: string) => weights.get(encoding) ?? weights.get("*") ?? 0;
    return ["br", "zstd", "gzip"].filter((x) => weight(x) > 0).sort((a, b) => weight(b) - weight(a));
};

const compressor = (encoding: string) => {
    if (encoding === "zstd") return zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 6 } });
    if (encoding === "br") return zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
    return zlib.createGzip({ level: 6 });
};

const vencordCompression = new ClientAssetCompression();

const stat = (file: string) => fs.promises.stat(file).catch(() => null);

const serveAsset = async (req: Request, res: Response, next: NextFunction, root: string, precompressed: boolean) => {
    const file = req.params.file as string;
    if (!/^\w[\w.-]*$/.test(file)) return next();
    const source = path.join(root, file);
    const sourceStat = await stat(source);
    if (!sourceStat?.isFile()) return next();

    res.set("Cache-Control", DEVELOPMENT || !precompressed || !HASHED.test(file) ? "no-cache" : "public, max-age=31536000, immutable");
    res.set("Access-Control-Allow-Origin", "*");
    if (!COMPRESSIBLE.test(file)) return res.sendFile(source, { cacheControl: false, dotfiles: "allow" });

    res.vary("Accept-Encoding");
    res.type(path.extname(file));
    const encodings = acceptedEncodings(req.headers["accept-encoding"]);
    for (const encoding of precompressed ? encodings : []) {
        if (!PRECOMPRESSED[encoding]) continue;
        const compressed = path.join(COMPRESSED_PATH, `${file}.${PRECOMPRESSED[encoding]}`);
        const compressedStat = await stat(compressed);
        if (!compressedStat || compressedStat.mtimeMs < Math.floor(sourceStat.mtimeMs)) continue;
        res.set("Content-Encoding", encoding);
        return res.sendFile(compressed, {
            cacheControl: false,
            acceptRanges: false,
            dotfiles: "allow",
        });
    }

    if (!encodings.length || sourceStat.size < 1024) return res.sendFile(source, { cacheControl: false, dotfiles: "allow" });
    res.set("Content-Encoding", encodings[0]);
    res.set("ETag", `W/"${sourceStat.size.toString(16)}-${createHash("sha1").update(clientAssetVersion(sourceStat)).digest("hex")}-${encodings[0]}"`);
    res.set("Last-Modified", sourceStat.mtime.toUTCString());
    if (req.fresh) return res.status(304).end();
    if (req.method === "HEAD") return res.end();
    if (root === VENCORD_PATH) {
        const compressed = await vencordCompression.get(source, sourceStat, encodings[0]);
        if (compressed) return res.send(compressed);
    }
    await pipeline(fs.createReadStream(source), compressor(encodings[0]), res).catch(() => res.destroy());
};

const joinReasonEnv = () => {
    const { joinReason, requireApproval } = Config.get().register;
    return joinReason.required || requireApproval
        ? { required: joinReason.required, minLength: joinReason.required ? joinReason.minLength : 0, maxLength: joinReason.maxLength, approval: requireApproval }
        : null;
};

export function TestClientAssets(app: Application) {
    const noCache = { setHeaders: (res: Response) => res.set("Cache-Control", "no-cache") };
    app.get(
        ["/assets/favicon.ico", "/favicon.ico", "/assets/favicon.svg", "/favicon.svg"],
        (req, res) => void sendBrandImage(res, instanceIcon() ?? { file: DEFAULT_FAVICON_FILE }, "no-cache"),
    );
    app.get(["/manifest.webmanifest", "/manifest.json"], (req, res) => {
        res.set("Cache-Control", "no-cache");
        res.type("application/manifest+json").send(JSON.stringify(appManifest()));
    });
    app.get("/assets/pwa/:file", async (req, res) => {
        const size = Number(/^icon-(180|192|512)\.png$/.exec(req.params.file as string)?.[1]);
        if (!size) return res.sendStatus(404);
        const png = await appIconPng(size);
        if (!png) return sendBrandImage(res, instanceIcon() ?? { file: DEFAULT_ICON_FILE }, "no-cache");
        res.set("Cache-Control", "public, max-age=21600").type("png").send(png);
    });
    app.get("/assets/:file", async (req, res, next) => {
        const branded = BRANDED_CLIENT_ASSETS[req.params.file as string];
        if (!branded) return next();
        res.set("Cache-Control", "no-cache");
        const logo = branded.wordmark && brandImageUrls().logo;
        if (logo) return res.redirect(302, logo);
        res.type("image/svg+xml").send(branded.svg(instanceName(), await instanceIconDataUri()));
    });
    app.get("/e2ee-sw.js", (req, res) => {
        res.set({ "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" });
        return res.type("js").sendFile(path.join(ASSET_FOLDER_PATH, "public", "e2ee", "sw.js"), {
            cacheControl: false,
            dotfiles: "allow",
        });
    });
    app.get("/mobile/meowcord.js", sendMobileBundle);
    app.get("/notifications-sw.js", (req, res) => {
        res.set("Cache-Control", "no-cache");
        return res.type("js").sendFile(path.join(ASSET_FOLDER_PATH, "public", "notifications", "sw.js"), {
            cacheControl: false,
            dotfiles: "allow",
        });
    });
    app.get("/e2ee/attachments/{*splat}", (req, res) => res.status(404).type("txt").send("This content is no longer available."));
    app.use("/assets", compressedStatic(path.join(ASSET_FOLDER_PATH, "public")), express.static(path.join(ASSET_FOLDER_PATH, "public")));
    app.get("/assets/vencord/:file", (req, res, next) => void serveAsset(req, res, next, VENCORD_PATH, false).catch(next));
    app.use("/assets/vencord", express.static(VENCORD_PATH, noCache));
    app.use("/vendor/monaco", express.static(path.join(VENCORD_PATH, "vendor", "monaco"), noCache));
    const manifestPath = path.join(CACHE_PATH, "release-manifest.json");
    const reviewedAssets = new Set<string>(fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")).assets : []);
    app.get("/assets/:file", (req, res, next) => {
        if (/\.(?:js|css|wasm)$/.test(req.params.file as string) && !reviewedAssets.has(req.params.file as string)) return res.sendStatus(404);
        return void serveAsset(req, res, next, CACHE_PATH, true).catch(next);
    });
}

const buildHtml = () => {
    const source = fs.readFileSync(path.join(CACHE_PATH, "index.html"), "utf8");
    const { client } = Config.get();

    const envMatch = source.match(GLOBAL_ENV_SCRIPT);
    if (!envMatch) throw new Error("[TestClient] assets/cache/index.html has no GLOBAL_ENV, rerun `bun run generate:client`");
    const sandbox: { window: { GLOBAL_ENV?: Record<string, unknown> } } = { window: {} };
    vm.runInNewContext(`window.GLOBAL_ENV =${envMatch[1]}`, sandbox);
    const images = brandImageUrls();
    const env = clientEnvScript(baseGlobalEnv(sandbox.window.GLOBAL_ENV ?? {}), {
        instanceName: client.instanceName,
        instanceId: instanceId(),
        activityApplicationHost: client.activityApplicationHost,
        loadingTips: client.loadingTips,
        loadingSvg: client.loadingSvg,
        icon: images.icon,
        logo: images.logo,
        helpUrl: helpUrl(),
        allowSlowmodeBypass: Config.get().limits.channel.allowSlowmodeBypass === true,
        e2eeTrustServer: Config.get().limits.e2ee.trustServerByDefault !== false,
        maxGroupDmRecipients: Config.get().limits.channel.maxGroupDmRecipients,
        emailRequired: Config.get().register.email.required === true,
        joinReason: joinReasonEnv(),
    });

    const patches = fs.existsSync(PATCH_PATH)
        ? fs
              .readdirSync(PATCH_PATH)
              .filter((x) => x.endsWith(".js"))
              .sort()
              .map((x) => `<script>${fs.readFileSync(path.join(PATCH_PATH, x), "utf8")}</script>`)
              .join("\n")
        : "";

    const vencord = vencordScriptTag(fs.existsSync(VENCORD_SCRIPT) ? createHash("sha256").update(fs.readFileSync(VENCORD_SCRIPT)).digest("hex").slice(0, 12) : null);
    const title = escapeTitle(client.instanceName);

    if (!vencord) console.warn("[TestClient] assets/vencord/vencord.js is missing, run `bun run build:vencord` to build the client mods");

    return finishClientHtml(prepareClientHtml(source), `${env}\n${vencord}\n${patches}`, title, appMetaTags(title, appIconUrl(180)));
};

const clientRoots = () => {
    const html = fs.readFileSync(path.join(CACHE_PATH, "index.html"), "utf8");
    const entry = html.match(/src="\/assets\/(web\.[0-9a-f]+\.js)"/)?.[1];
    if (!entry) return null;
    return clientRootsFromEntry(fs.readFileSync(path.join(CACHE_PATH, entry), "utf8"));
};

const FRIEND_NAME = /^[\p{L}\p{N}_.-]{1,32}$/u;

const renderAddFriend = (origin: string, name: string) => {
    const handle = `${name}@${instanceId() ?? new URL(origin).host}`;
    const preview = openGraphTags(origin, {
        title: `Add ${name} on ${instanceName()}`,
        description: `Add ${handle} as a friend from any Meowcord instance.`,
        url: `/add/${encodeURIComponent(name)}`,
    });
    return brandPage(fs.readFileSync(path.join(ASSET_FOLDER_PATH, "public", "add-friend.html"), "utf8"))
        .replace("__OPEN_GRAPH__", preview)
        .replaceAll("__FRIEND_NAME__", escapeHtml(name))
        .replaceAll("__FRIEND_HANDLE__", escapeHtml(handle))
        .replaceAll("__OPEN_HREF__", escapeHtml(`/channels/@me?add=${encodeURIComponent(name)}`));
};

const renderNotFound = () => brandPage(fs.readFileSync(path.join(ASSET_FOLDER_PATH, "public", "not-found.html"), "utf8"));

const renderPage = () => {
    const html = buildHtml();
    const body = Buffer.from(html);
    return {
        html,
        body,
        etag: `"${createHash("sha1").update(body).digest("base64url")}"`,
        br: zlib.brotliCompressSync(body, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
                [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
            },
        }),
        gzip: zlib.gzipSync(body, { level: 9 }),
    };
};

export default function TestClient(app: Application) {
    if (!Config.get().client.useTestClient || !fs.existsSync(path.join(CACHE_PATH, "index.html"))) return;
    require(path.resolve(__dirname, "../../scripts/client-release.js")).check(CACHE_PATH);

    const brandStamp = () =>
        JSON.stringify([
            Config.get().client,
            brandImageUrls(),
            helpUrl(),
            Config.get().limits.channel.maxGroupDmRecipients,
            Config.get().limits.channel.allowSlowmodeBypass,
            Config.get().limits.e2ee.trustServerByDefault,
            Config.get().register.email.required,
            Config.get().register.joinReason,
            Config.get().register.requireApproval,
        ]);
    let brand = brandStamp();
    let page = renderPage();
    let roots = clientRoots();
    const missLog = path.join(ASSET_FOLDER_PATH, "cacheMisses");

    app.get("/assets/version.:channel.json", (req, res) => {
        const hash = fs.readFileSync(path.join(CACHE_PATH, "index.html"), "utf8").match(/"VERSION_HASH":"(\w+)"/)?.[1];
        res.set("Cache-Control", "no-cache").json({ hash, required: false });
    });

    app.get("/assets/:file", async (req, res) => {
        const file = req.params.file;
        if (!/^[\w.-]+$/.test(file) || /\.(?:map|js|css|wasm)$/.test(file)) return res.sendStatus(404);
        if (!Config.get().externalRequests.discordClientAssets) return res.sendStatus(404);
        const upstream = await fetch(`${UPSTREAM}/assets/${file}`, {
            signal: AbortSignal.timeout(15000),
            redirect: "error",
        }).catch(() => null);
        if (!upstream?.ok) return res.sendStatus(upstream?.status ?? 502);
        const contentType = upstream.headers.get("content-type");
        if (contentType) res.type(contentType);
        fs.promises.appendFile(missLog, `${file}\n`).catch(() => {});
        const body = Buffer.from(await upstream.arrayBuffer());
        await fs.promises.writeFile(path.join(CACHE_PATH, file), body).catch(() => {});
        res.send(body);
    });

    const sourceStamp = () =>
        [path.join(CACHE_PATH, "index.html"), PATCH_PATH, VENCORD_SCRIPT, ...(fs.existsSync(PATCH_PATH) ? fs.readdirSync(PATCH_PATH).map((x) => path.join(PATCH_PATH, x)) : [])]
            .map((x) => fs.statSync(x, { throwIfNoEntry: false })?.mtimeMs ?? 0)
            .join();
    let stamp = DEVELOPMENT ? sourceStamp() : "";

    app.get("/add/:name", async (req, res, next) => {
        const name = String(req.params.name);
        if (!FRIEND_NAME.test(name)) return next();
        const user = await User.findOne({ where: { username: name, federated_instance: IsNull(), bot: false, deleted: false }, select: { id: true, username: true } }).catch(
            () => null,
        );
        if (!user) return next();
        res.set("Cache-Control", "no-cache")
            .type("html")
            .send(renderAddFriend(requestOrigin(req), name));
    });

    app.get("/gift/:code", (req, res) => res.redirect(`/gifts/${encodeURIComponent(req.params.code)}`));

    app.get("/{*splat}", (req, res, next) => {
        if (/^\/(api|cdn|attachments|avatars|icons|banners|emojis|stickers|imageproxy)\b/.test(req.path)) return next();
        const sourceChanged = DEVELOPMENT && stamp !== (stamp = sourceStamp());
        if (sourceChanged) roots = clientRoots();
        if (sourceChanged || brand !== (brand = brandStamp())) page = renderPage();
        if (roots && !roots.has(req.path.split("/")[1].toLowerCase())) return res.status(404).set("Cache-Control", "no-cache").type("html").send(renderNotFound());
        const inviteCode = inviteCodeFromPath(req.path);
        if (inviteCode)
            return void invitePage(inviteCode)
                .then((preview) => {
                    const body = Buffer.from(page.html.replace("</head>", `    ${openGraphTags(requestOrigin(req), preview ?? instancePage())}\n</head>`));
                    res.set("Cache-Control", "no-cache").type("html");
                    res.vary("Accept-Encoding");
                    if (!acceptedEncodings(req.headers["accept-encoding"]).includes("gzip")) return res.send(body);
                    res.set("Content-Encoding", "gzip").send(zlib.gzipSync(body));
                })
                .catch(next);
        res.set({ "Cache-Control": "no-cache", ETag: page.etag });
        res.vary("Accept-Encoding");
        res.type("html");
        if (req.fresh) return res.status(304).end();
        const encoding = acceptedEncodings(req.headers["accept-encoding"]).find((x) => x === "br" || x === "gzip") as "br" | "gzip" | undefined;
        if (encoding) res.set("Content-Encoding", encoding);
        res.send(encoding ? page[encoding] : page.body);
    });
}
