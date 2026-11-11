const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { DEFAULT_AVATAR_COLORS, DEFAULT_AVATARS_FOLDER } = require(path.join(ROOT, "dist", "util", "util", "DefaultAvatars.js"));
const SIZE = 256;
const MARK = 148;

const localFile = (value) => {
    if (typeof value !== "string" || !value.trim() || /^https?:\/\//i.test(value)) return null;
    const file = path.resolve(ROOT, value.trim());
    return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
};

const configuredIcon = () => {
    if (!process.env.CONFIG_PATH) return null;
    try {
        const config = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, "utf8"));
        return localFile(config.client?.icon) ?? localFile(config.general?.image);
    } catch {
        return null;
    }
};

const main = async () => {
    let sharp;
    try {
        sharp = require("sharp");
    } catch {
        console.warn("[default-avatars] sharp is not installed, the CDN will draw default avatars as SVG instead");
        return;
    }
    const icon = localFile(process.env.DEFAULT_AVATAR_ICON) ?? configuredIcon() ?? path.join(ROOT, "assets", "public", "branding", "meowcord.svg");
    const { data: alpha, info } = await sharp(icon).resize(MARK, MARK, { fit: "inside" }).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const mark = await sharp({
        create: { width: info.width, height: info.height, channels: 3, background: "#ffffff" },
    })
        .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
        .png()
        .toBuffer();
    fs.mkdirSync(DEFAULT_AVATARS_FOLDER, { recursive: true });
    await Promise.all(
        DEFAULT_AVATAR_COLORS.map((background, index) =>
            sharp({ create: { width: SIZE, height: SIZE, channels: 4, background } })
                .composite([
                    {
                        input: mark,
                        left: Math.round((SIZE - info.width) / 2),
                        top: Math.round((SIZE - info.height) / 2),
                    },
                ])
                .png({ compressionLevel: 9, palette: true })
                .toFile(path.join(DEFAULT_AVATARS_FOLDER, `${index}.png`)),
        ),
    );
    console.log(`[default-avatars] wrote ${DEFAULT_AVATAR_COLORS.length} avatars from ${path.relative(ROOT, icon)}`);
};

main().catch((error) => console.warn("[default-avatars] could not draw the avatars, the CDN will draw them as SVG instead:", error));
