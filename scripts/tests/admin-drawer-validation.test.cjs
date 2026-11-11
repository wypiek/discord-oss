const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");

const schemas = JSON.parse(fs.readFileSync("assets/schemas.json", "utf8"));
const admin = fs.readFileSync("assets/public/admin/admin.js", "utf8");

test("every admin position the database stores as an int is bounded to one", () => {
    for (const name of [
        "AdminStatusComponentSchema",
        "AdminStatusComponentUpdateSchema",
        "AdminStorePackCreateSchema",
        "AdminStorePackUpdateSchema",
        "AdminStoreItemCreateSchema",
        "AdminStoreItemUpdateSchema",
    ]) {
        const position = schemas[name].properties.position;
        assert.equal(position.type, "integer", name);
        assert.equal(position.minimum, -2147483648, name);
        assert.equal(position.maximum, 2147483647, name);
    }
});

test("drawer fields stop at the limits the server enforces", () => {
    const guild = schemas.AdminGuildUpdateSchema.properties;
    assert.equal(guild.tag.maxLength, 32);
    assert.match(admin, /<input name="tag" autocomplete="off" maxlength="32"/);
    assert.equal(guild.preferred_locale.maxLength, 16);
    assert.match(admin, /name="preferred_locale" value="\$\{g\.preferred_locale \?\? "en-US"\}" required maxlength="16"/);
    assert.equal(guild.owner_id.maxLength, 20);
    assert.match(admin, /name="owner_id" value="\$\{g\.owner\?\.id \?\? ""\}" inputmode="numeric" pattern="\[0-9\]\{1,20\}" maxlength="20"/);
    assert.equal(schemas.AdminStatusComponentSchema.properties.description.maxLength, 500);
    assert.match(admin, /aria-label="Component description" maxlength="500"/);
    assert.match(admin, /<textarea name="description" maxlength="500">\$\{component\.description/);
    assert.equal(schemas.AdminStatusIncidentPostUpdateSchema.properties.body.maxLength, 4000);
    assert.match(admin, /<textarea name="body" aria-label="Update" maxlength="4000"/);
    assert.match(admin, /<textarea name="body" required maxlength="4000"/);
    assert.equal(schemas.AdminBadgeCreateSchema.properties.link.maxLength, 2048);
    assert.match(admin, /name="link" type="url" maxlength="2048"/);
});
