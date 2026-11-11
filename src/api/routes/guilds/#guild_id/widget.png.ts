/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { storage } from "@spacebar/cdn/util/Storage";
import { Guild } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { withinBrandImageLimits } from "@spacebar/util/util/BrandAssetRequest";

const router: Router = Router({ mergeParams: true });

const STYLES = ["shield", "banner1", "banner2", "banner3", "banner4"];
const BLURPLE = 0x5865f2ff;
const DARK = 0x2b2d31ff;
const GREY = 0x555555ff;

let jimp: any;
const fonts: Record<string, Promise<any>> = {};
const attributes = (xml: string, tag: string) =>
    [...xml.matchAll(new RegExp(`<${tag}\\s([^>]*?)/?>`, "g"))].map(
        ([, body]) =>
            Object.fromEntries([...body.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, /^-?\d+$/.test(value) ? Number(value) : value])) as Record<string, any>,
    );
const font = (name: "SANS_8_WHITE" | "SANS_16_WHITE" | "SANS_32_WHITE") => {
    fonts[name] ??= (async () => {
        const file: string = require("jimp/fonts")[name];
        const xml = await readFile(file, "utf8");
        const pages: any[] = [];
        for (const page of attributes(xml, "page")) pages[page.id] = await jimp.Jimp.read(await readFile(path.join(path.dirname(file), page.file)));
        const kernings: Record<string, Record<string, number>> = {};
        for (const { first, second, amount } of attributes(xml, "kerning")) (kernings[String.fromCharCode(first)] ??= {})[String.fromCharCode(second)] = amount;
        return {
            info: attributes(xml, "info")[0],
            common: attributes(xml, "common")[0],
            pages,
            chars: Object.fromEntries(attributes(xml, "char").map((char) => [String.fromCharCode(char.id), char])),
            kernings,
        };
    })().catch((error) => {
        delete fonts[name];
        throw error;
    });
    return fonts[name];
};

router.get(
    "/",
    route({
        responses: {
            200: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };

        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        if (!guild.widget_enabled) throw DiscordApiErrors.EMBED_DISABLED;

        const style = req.query.style?.toString() || "shield";
        if (!STYLES.includes(style)) throw new HTTPError("Value must be one of ('shield', 'banner1', 'banner2', 'banner3', 'banner4').", 400);

        try {
            jimp ??= require("jimp");
        } catch {
            throw new HTTPError("Widget images are not available on this instance.", 501);
        }
        const { Jimp, measureText } = jimp;

        const online = await Guild.countPresences(guild_id);
        const presence = `${online} Online`;
        const [small, medium, large] = await Promise.all([font("SANS_8_WHITE"), font("SANS_16_WHITE"), font("SANS_32_WHITE")]).catch(() => {
            throw new HTTPError("Widget images are not available on this instance.", 501);
        });
        const fit = (text: string, f: any, width: number) => {
            if (measureText(f, text) <= width) return text;
            let cut = text;
            while (cut.length > 1 && measureText(f, `${cut}...`) > width) cut = cut.slice(0, -1);
            return `${cut}...`;
        };

        const iconImage = async (size: number) => {
            const file = guild.icon ? await storage.get(`icons/${guild_id}/${guild.icon}`).catch(() => null) : null;
            const image = file && withinBrandImageLimits(file, { maxSide: 4096, maxPixels: 4096 * 4096 }) ? await Jimp.read(file).catch(() => null) : null;
            const icon = image ? image.cover({ w: size, h: size }) : new Jimp({ width: size, height: size, color: 0x4e5058ff });
            return icon.circle();
        };

        if (style === "shield") {
            const label = "Discord";
            const left = measureText(small, label) + 12;
            const right = measureText(small, presence) + 12;
            const image = new Jimp({ width: left + right, height: 20, color: GREY });
            image.composite(new Jimp({ width: right, height: 20, color: BLURPLE }), left, 0);
            image.print({ font: small, x: 6, y: 5, text: label });
            image.print({ font: small, x: left + 6, y: 5, text: presence });
            res.set("Content-Type", "image/png");
            res.set("Cache-Control", "public, max-age=300");
            return res.send(await image.getBuffer("image/png"));
        }

        const layouts: Record<
            string,
            {
                width: number;
                height: number;
                icon: number;
                x: number;
                y: number;
                join?: boolean;
                hero?: number;
            }
        > = {
            banner1: { width: 320, height: 82, icon: 50, x: 16, y: 16, join: true },
            banner2: { width: 320, height: 76, icon: 36, x: 14, y: 20, join: true },
            banner3: { width: 320, height: 68, icon: 50, x: 9, y: 9 },
            banner4: { width: 320, height: 194, icon: 50, x: 16, y: 130, hero: 116 },
        };
        const layout = layouts[style];
        const image = new Jimp({
            width: layout.width,
            height: layout.height,
            color: layout.hero ? DARK : BLURPLE,
        });
        if (layout.hero) {
            image.composite(new Jimp({ width: layout.width, height: layout.hero, color: BLURPLE }), 0, 0);
            image.print({
                font: large,
                x: 16,
                y: layout.hero / 2 - 18,
                text: fit("Join my server", large, layout.width - 32),
            });
        }
        const joinWidth = layout.join ? 64 : 0;
        if (layout.join) {
            const button = new Jimp({ width: joinWidth - 12, height: 28, color: 0xffffff33 });
            image.composite(button, layout.width - joinWidth, Math.round(layout.height / 2 - 14));
            image.print({
                font: small,
                x: layout.width - joinWidth + 15,
                y: Math.round(layout.height / 2 - 6),
                text: "Join",
            });
        }
        image.composite(await iconImage(layout.icon), layout.x, layout.y);
        const textX = layout.x + layout.icon + 12;
        const textWidth = layout.width - textX - joinWidth - 12;
        const textY = layout.y + Math.round(layout.icon / 2) - 16;
        image.print({ font: medium, x: textX, y: textY, text: fit(guild.name, medium, textWidth) });
        image.print({ font: small, x: textX, y: textY + 20, text: fit(presence, small, textWidth) });

        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=300");
        return res.send(await image.getBuffer("image/png"));
    },
);

export default router;
