const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const generator = () => import(path.join(__dirname, "..", "steam-frames.mjs"));
const hash = (char) => char.repeat(40);

const definition = (overrides = {}, data = {}) => ({
    appid: 795040,
    defid: 4104200,
    type: 1,
    community_item_class: 14,
    community_item_type: 37,
    point_cost: "2000",
    timestamp_created: 1792429454,
    active: true,
    ...overrides,
    community_item_data: {
        item_name: "Pumping",
        item_title: "Pumping",
        item_image_small: `${hash("a")}.png`,
        item_image_large: `${hash("b")}.png`,
        animated: true,
        tiled: false,
        ...data,
    },
});

test("the generator keeps active avatar frames with valid art, sorted by definition id", async () => {
    const { framesFromDefinitions } = await generator();
    const frames = framesFromDefinitions([
        definition({ defid: 9 }, { item_title: "  Later  ", item_description: "Spins." }),
        definition({ defid: 3 }),
        definition({ defid: 3 }, { item_title: "Duplicate" }),
        definition({ defid: 4, community_item_class: 15 }),
        definition({ defid: 5, active: false }),
        definition({ defid: 6 }, { item_image_small: "../../etc/passwd" }),
        definition({ defid: 7 }, { item_title: "", item_name: "" }),
        definition({ defid: -1 }),
        definition({ defid: 8 }, { animated: false, item_image_small: `${hash("c")}.png`, item_image_large: `${hash("c")}.png` }),
        null,
    ]);
    assert.deepEqual(
        frames.map((x) => [x.defid, x.name]),
        [
            [3, "Duplicate"],
            [8, "Pumping"],
            [9, "Later"],
        ],
    );
    assert.deepEqual(frames[2], {
        defid: 9,
        appid: 795040,
        name: "Later",
        description: "Spins.",
        animated: true,
        image: `${hash("a")}.png`,
        still: `${hash("b")}.png`,
        created: 1792429454,
    });
    assert.equal(frames[1].animated, false);
});

test("a frame without a still image falls back to its animation", async () => {
    const { framesFromDefinitions } = await generator();
    const [frame] = framesFromDefinitions([definition({}, { item_image_large: undefined })]);
    assert.equal(frame.still, frame.image);
    assert.equal(frame.animated, false);
});

test("app names come from successful store items only", async () => {
    const { appNamesFromItems } = await generator();
    assert.deepEqual(
        appNamesFromItems([
            { appid: 730, id: 730, success: 1, name: "Counter-Strike 2" },
            { id: 570, success: 1, name: " Dota 2 " },
            { appid: 1, success: 2, name: "Missing" },
            { appid: 2, success: 1 },
            null,
        ]),
        { 570: "Dota 2", 730: "Counter-Strike 2" },
    );
});

test("the catalog file is deterministic, one frame per line, and only names apps that have frames", async () => {
    const { framesFromDefinitions, serializeCatalog } = await generator();
    const frames = framesFromDefinitions([definition({ defid: 2, appid: 20 }), definition({ defid: 1, appid: 10 })]);
    const text = serializeCatalog(frames, { 30: "Unused", 20: "Twenty", 10: "Ten" });
    assert.equal(text, serializeCatalog(frames, { 10: "Ten", 20: "Twenty", 30: "Unused" }));
    const parsed = JSON.parse(text);
    assert.deepEqual(parsed.apps, { 10: "Ten", 20: "Twenty" });
    assert.deepEqual(
        parsed.frames.map((x) => x.defid),
        [1, 2],
    );
    assert.equal(text.split("\n").filter((line) => line.includes('"defid"')).length, 2);
});

test("the committed catalog parses, has unique ids and only steam art names", () => {
    const catalog = require("../../assets/steam-frames.json");
    assert.ok(catalog.frames.length > 1000);
    assert.equal(new Set(catalog.frames.map((x) => x.defid)).size, catalog.frames.length);
    assert.ok(catalog.frames.every((x, i, all) => i === 0 || all[i - 1].defid < x.defid));
    assert.ok(catalog.frames.every((x) => /^[0-9a-f]{40}\.(?:png|apng|jpg|gif)$/.test(x.image) && /^[0-9a-f]{40}\.(?:png|apng|jpg|gif)$/.test(x.still)));
});

test("excluded frames are dropped with a recorded reason", async () => {
    const { framesFromDefinitions, EXCLUDED_FRAMES } = await generator();
    assert.ok(EXCLUDED_FRAMES.size > 0);
    assert.ok([...EXCLUDED_FRAMES.values()].every((reason) => typeof reason === "string" && reason.length > 20));
    const [excluded] = EXCLUDED_FRAMES.keys();
    assert.deepEqual(
        framesFromDefinitions([definition({ defid: excluded }), definition({ defid: 1 })]).map((x) => x.defid),
        [1],
    );
});

test("the committed catalog has none of the excluded frames", async () => {
    const { EXCLUDED_FRAMES } = await generator();
    const catalog = require("../../assets/steam-frames.json");
    assert.ok(catalog.frames.every((x) => !EXCLUDED_FRAMES.has(x.defid)));
});
