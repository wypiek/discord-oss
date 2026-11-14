const path = require("node:path");

process.env.IP_HASH_SECRET ||= "unit-test-ip-hash-secret-0123456789abcdef";

module.exports = require(path.join(__dirname, "../../../dist/util/util/IpHash"));
