const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const sharp = require("sharp");
const { imageVariant, renderImageVariant, cachedImageVariant, isAnimatedImage, imageHash } = require("../../dist/cdn/util/imageVariants");

const FRAME_COLORS = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
];

function frames(width, height, count) {
    const pixels = Buffer.alloc(width * height * count * 4);
    for (let frame = 0; frame < count; frame++)
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const offset = ((frame * height + y) * width + x) * 4;
                const [r, g, b] = FRAME_COLORS[frame % FRAME_COLORS.length];
                pixels.set([r, y < height / 2 ? g : 255 - g, b, 255], offset);
            }
    return sharp(pixels, { raw: { width, height: height * count, channels: 4, pageHeight: height } });
}

const delay = [120, 80, 120, 80];
const animatedGif = () => frames(960, 540, 4).gif({ delay, loop: 0 }).toBuffer();
const animatedWebp = () => frames(960, 540, 4).webp({ delay, loop: 0 }).toBuffer();
const staticGif = () => frames(320, 180, 1).gif().toBuffer();
const staticWebp = () => frames(320, 180, 1).webp().toBuffer();
const staticPng = () => frames(320, 180, 1).png().toBuffer();

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}
function apng(width, height, count) {
    const u32 = (...values) => Buffer.concat(values.map((value) => Buffer.from([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255])));
    const u16 = (value) => Buffer.from([value >> 8, value & 255]);
    const ihdr = Buffer.concat([u32(width, height), Buffer.from([8, 6, 0, 0, 0])]);
    const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("acTL", u32(count, 0))];
    let sequence = 0;
    for (let frame = 0; frame < count; frame++) {
        const [r, g, b] = FRAME_COLORS[frame % FRAME_COLORS.length];
        const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4).map((_, i) => [r, g, b, 255][i % 4])]);
        const data = zlib.deflateSync(Buffer.concat(Array(height).fill(row)));
        parts.push(chunk("fcTL", Buffer.concat([u32(sequence++, width, height, 0, 0), u16(1), u16(10), Buffer.from([0, 0])])));
        parts.push(frame === 0 ? chunk("IDAT", data) : chunk("fdAT", Buffer.concat([u32(sequence++), data])));
    }
    parts.push(chunk("IEND", Buffer.alloc(0)));
    return Buffer.concat(parts);
}

const metadata = (buffer) => sharp(buffer, { animated: true }).metadata();
const variant = (name, query = {}) => imageVariant(name, query);

test("requests choose format, size and animation the way Discord's CDN does", () => {
    assert.deepEqual(variant("a_1.gif", { size: "480" }), { format: "gif", size: 480, animated: true, lossless: false });
    assert.deepEqual(variant("a_1.webp", { size: "600", animated: "true" }), { format: "webp", size: 600, animated: true, lossless: false });
    assert.deepEqual(variant("a_1.webp", { size: "600" }), { format: "webp", size: 600, animated: false, lossless: false });
    assert.deepEqual(variant("a_1.jpg", { size: "480", quality: "lossless" }), { format: "jpeg", size: 480, animated: false, lossless: true });
    assert.deepEqual(variant("a_1.png", { animated: "true" }), { format: "png", size: undefined, animated: false, lossless: false });
    assert.deepEqual(variant("a_1.gif", { animated: "false" }), { format: "gif", size: undefined, animated: false, lossless: false });
    assert.deepEqual(variant("a_1", {}), { format: undefined, size: undefined, animated: true, lossless: false });
    assert.equal(variant("1.png", { size: "100000" }).size, 4096);
    assert.equal(variant("1.png", { size: "1" }).size, 16);
    assert.equal(variant("1.png", { size: "abc" }).size, undefined);
});

test("animated GIF, WebP and APNG uploads get the a_ hash and static ones don't", async () => {
    const cases = [
        [await animatedGif(), "image/gif", true],
        [await staticGif(), "image/gif", false],
        [await animatedWebp(), "image/webp", true],
        [await staticWebp(), "image/webp", false],
        [apng(16, 9, 3), "image/apng", true],
        [await staticPng(), "image/png", false],
    ];
    for (const [buffer, mime, animated] of cases) {
        assert.equal(isAnimatedImage(buffer, mime), animated, mime);
        assert.equal(imageHash(buffer, mime).startsWith("a_"), animated, mime);
        assert.match(imageHash(buffer, mime), /^(a_)?[0-9a-f]{32}$/);
    }
});

test("animated resizes keep every frame, the frame size, the delays and the loop", async () => {
    for (const [source, mime] of [
        [await animatedGif(), "image/gif"],
        [await animatedWebp(), "image/webp"],
    ])
        for (const [name, query, format] of [
            ["a_1.gif", { size: "480" }, "gif"],
            ["a_1.webp", { size: "480", animated: "true" }, "webp"],
        ]) {
            const output = await renderImageVariant(source, mime, variant(name, query));
            assert.equal(output.mime, `image/${format}`);
            const info = await metadata(output.body);
            assert.equal(info.format, format);
            assert.equal(info.pages, 4, `${mime} -> ${name}`);
            assert.equal(info.width, 480);
            assert.equal(info.pageHeight, 270);
            assert.equal(info.height, 270 * 4);
            assert.deepEqual(info.delay, delay);
            assert.equal(info.loop, 0);
            const second = await sharp(output.body, { page: 1 }).raw().toBuffer({ resolveWithObject: true });
            assert.equal(second.info.height, 270);
            assert.ok(second.data[1] > 200 && second.data[0] < 60, `${mime} -> ${name} second frame is green`);
        }
});

test("static requests for an animated banner return one frame at the requested size", async () => {
    const source = await animatedGif();
    for (const [name, query, format] of [
        ["a_1.png", { size: "240" }, "png"],
        ["a_1.jpg", { size: "480", quality: "lossless" }, "jpeg"],
        ["a_1.webp", { size: "600" }, "webp"],
        ["a_1.gif", { size: "300", animated: "false" }, "gif"],
    ]) {
        const output = await renderImageVariant(source, "image/gif", variant(name, query));
        const info = await metadata(output.body);
        const width = Number(query.size);
        assert.equal(info.format, format, name);
        assert.equal(info.pages ?? 1, 1, name);
        assert.equal(info.width, width, name);
        assert.equal(info.height, Math.round((width * 9) / 16), name);
    }
});

test("sizes never upscale, keep the aspect ratio and fit tall images inside the box", async () => {
    const tall = await frames(300, 600, 2)
        .gif({ delay: [100, 100] })
        .toBuffer();
    const output = await renderImageVariant(tall, "image/gif", variant("a_1.gif", { size: "240" }));
    const info = await metadata(output.body);
    assert.deepEqual([info.width, info.pageHeight, info.pages], [120, 240, 2]);
    const small = await animatedGif();
    const unchanged = await renderImageVariant(small, "image/gif", variant("a_1.gif", { size: "4096" }));
    assert.equal(unchanged.body, small);
    const original = await renderImageVariant(small, "image/gif", variant("a_1", {}));
    assert.equal(original.body, small);
});

test("APNG keeps its animation for animated requests and gives its first frame for static ones", async () => {
    const source = apng(64, 36, 3);
    const animated = await renderImageVariant(source, "image/apng", variant("a_1.gif", { size: "32" }));
    assert.equal(animated.body, source);
    const still = await renderImageVariant(source, "image/apng", variant("a_1.png", { size: "32" }));
    const info = await metadata(still.body);
    assert.deepEqual([info.format, info.width, info.height, info.pages ?? 1], ["png", 32, 18, 1]);
});

test("rendered variants are cached and identical requests share one render", async () => {
    const source = await animatedGif();
    const request = variant("a_1.gif", { size: "128" });
    const [first, second] = await Promise.all([cachedImageVariant("banners/1/a_x", source, request), cachedImageVariant("banners/1/a_x", source, request)]);
    assert.equal(first, second);
    assert.equal(await cachedImageVariant("banners/1/a_x", source, request), first);
    const info = await metadata(first.body);
    assert.deepEqual([info.width, info.pageHeight, info.pages], [128, 72, 4]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
    const passthrough = await cachedImageVariant("banners/1/svg", svg, variant("1.png", { size: "64" }));
    assert.equal(passthrough.body, svg);
});
