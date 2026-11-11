const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
const svg = (slug) => fs.readFileSync(path.join(root, "assets/badge-icons", `pride_${slug}.svg`));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/badge-icons/twemoji-flags/manifest.json"), "utf8"));
test("every upstream flag matches its pinned checksum and remains selectable", async () => {
    const { createHash } = require("node:crypto");
    assert.equal(manifest.commit, "1eee036f2567edc1f56f7dcb4105eae5a347cc7b");
    assert.deepEqual(
        manifest.supplementalFlags.map((flag) => flag.slug),
        manifest.supplementalSlugs,
    );
    assert.deepEqual(manifest.excluded, ["TEMPLATE_FLAG.svg"]);
    assert.equal(new Set(manifest.flags.map((flag) => flag.file)).size, manifest.flags.length);
    assert.deepEqual(fs.readdirSync(path.join(root, "assets/badge-icons/twemoji-flags/flags")).sort(), [...manifest.flags.map((flag) => flag.file), manifest.template.file].sort());
    for (const flag of manifest.supplementalFlags) {
        assert.equal(
            createHash("sha256")
                .update(svg(flag.slug.replaceAll("-", "_")))
                .digest("hex"),
            flag.sha256,
        );
        assert.equal(flag.derivedFrom, "TEMPLATE_FLAG.svg");
    }
    const catalog = fs.readFileSync(path.join(root, "src/api/util/utility/prideBadges.ts"), "utf8");
    for (const flag of manifest.flags) {
        const original = fs.readFileSync(path.join(root, "assets/badge-icons/twemoji-flags/flags", flag.file));
        assert.equal(createHash("sha256").update(original).digest("hex"), flag.sha256);
        assert.deepEqual(svg(flag.slug.replaceAll("-", "_")), original);
        assert.ok(catalog.includes(`slug: "${flag.slug}"`));
        assert.ok(catalog.includes(`icon: "${flag.icon}"`));
    }
});

test("every local SVG regenerates offline and renders without external resources", async () => {
    execFileSync(process.execPath, ["scripts/pride-badge-art.cjs", "--check"], { cwd: root });
    const files = fs.readdirSync(path.join(root, "assets/badge-icons")).filter((file) => /^pride_.*\.svg$/.test(file));
    assert.equal(files.length, manifest.flags.length + manifest.supplementalSlugs.length);
    for (const file of files) {
        const content = fs.readFileSync(path.join(root, "assets/badge-icons", file));
        assert.doesNotMatch(content.toString(), /<(?:script|image|foreignObject)\b|(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/)|url\((?!#)/i);
        assert.match(content.toString(), /viewBox="0 0 36 36"/);
        const rendered = await sharp(content).resize(30, 30).ensureAlpha().raw().toBuffer();
        assert.equal(rendered.length, 30 * 30 * 4);
        assert.ok(rendered.some((value, index) => index % 4 === 3 && value > 0));
    }
});

test("supplemental flags use the upstream silhouette and keep the intersex circle round and visible", async () => {
    const template = fs.readFileSync(path.join(root, "assets/badge-icons/twemoji-flags/flags/TEMPLATE_FLAG.svg"), "utf8");
    const silhouette = template.match(/\bd="([^"]+)"/)[1];
    for (const slug of manifest.supplementalSlugs) {
        const content = svg(slug.replaceAll("-", "_")).toString();
        assert.ok(content.includes(`d="${silhouette}"`));
        assert.match(content, /viewBox="0 0 36 36"/);
        const image = await sharp(Buffer.from(content)).resize(36, 36).ensureAlpha().raw().toBuffer();
        const alpha = (x, y) => image[(y * 36 + x) * 4 + 3];
        assert.equal(alpha(18, 2), 0, `${slug} leaves the canvas above the flag empty`);
        assert.equal(alpha(18, 33), 0, `${slug} leaves the canvas below the flag empty`);
        for (const [x, y] of [
            [18, 6],
            [18, 30],
            [1, 18],
            [34, 18],
        ])
            assert.equal(alpha(x, y), 255, `${slug} fills the flag silhouette`);
    }
    const content = svg("intersex_progress");
    assert.match(content.toString(), /circle cx="3.24" cy="18" r="2.4"/);
    const image = await sharp(content).resize(360, 360).removeAlpha().raw().toBuffer();
    const color = (x, y) => image.subarray((y * 360 + x) * 3, (y * 360 + x) * 3 + 3).toString("hex");
    assert.equal(color(32, 180), "ffd800");
    assert.equal(color(32, 156), "7902aa");
    assert.equal(color(32, 204), "7902aa");
    assert.equal(color(8, 180), "7902aa");
    assert.equal(color(56, 180), "7902aa");
});
