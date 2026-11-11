const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const number = (value) => Number(value.toFixed(6));
const heart = (x, y, w, h) => {
    const p = (px, py) => `${number(x + px * w)} ${number(y + py * h)}`;
    return `M${p(0.5, 1)}C${p(0.27, 0.82)} ${p(0, 0.62)} ${p(0, 0.3)}C${p(0, 0.12)} ${p(0.14, 0)} ${p(0.3, 0)}C${p(0.39, 0)} ${p(0.46, 0.05)} ${p(0.5, 0.12)}C${p(0.54, 0.05)} ${p(0.61, 0)} ${p(0.7, 0)}C${p(0.86, 0)} ${p(1, 0.12)} ${p(1, 0.3)}C${p(1, 0.62)} ${p(0.73, 0.82)} ${p(0.5, 1)}Z`;
};
const romantic = {
    symbol: `<path d="M0 0H36V36H0Z${heart(7, 6.2, 22, 24.6)}" fill="#FFFFFF" fill-opacity=".5" fill-rule="evenodd"/>`,
};
const feather = (angle) =>
    `<g transform="translate(18 11.4) rotate(${angle})"><path d="M0 0C2.2 3.6 2.4 11.2 2 14.6Q0 18-2 14.6C-2.4 11.2-2.2 3.6 0 0Z" fill="#FFFFFF" stroke="#000000" stroke-width=".5"/><path d="M-2.35 10.6H2.35C2.35 12.4 2.25 13.8 2 14.6Q0 18-2 14.6C-2.25 13.8-2.35 12.4-2.35 10.6Z" fill="#000000"/><path d="M0 1.5V16.5" stroke="#000000" stroke-width=".35"/></g>`;
const mogai = (() => {
    const outer = ["BC57B4", "754EFB", "5680E7", "30DDEF", "58D9BA", "3CFE57", "9FEE43", "FFF729", "FECE33", "FBA23E", "F87B4A", "F65156"];
    const inner = ["242424", "494949", "6E6E6E", "929292", "B6B6B6", "DBDBDB", "B6B6B6", "929292", "6E6E6E", "494949", "242424", "000000"];
    const point = (radius, step) => {
        const angle = -Math.PI / 2 + (step * Math.PI) / 6;
        return `${number(18 + Math.cos(angle) * radius)} ${number(18 + Math.sin(angle) * radius)}`;
    };
    const ring = (colors, r0, r1) =>
        colors
            .map((color, i) => `<path d="M${point(r1, i)}A${r1} ${r1} 0 0 1 ${point(r1, i + 1)}L${point(r0, i + 1)}A${r0} ${r0} 0 0 0 ${point(r0, i)}Z" fill="#${color}"/>`)
            .join("");
    return ring(outer, 7.9, 10.5) + ring(inner, 5.3, 7.92);
})();
const demifluid = ["FFB0CA", "FFDEB0", "FFEEA7", "D0E5D0", "ACDCF3"];

const flags = [
    ["rainbow", "Rainbow", ["E40303", "FF8C00", "FFED00", "008026", "004DFF", "750787"]],
    ["original-rainbow", "Original rainbow (eight stripes)", ["FF69B4", "E40303", "FF8C00", "FFED00", "008026", "00C0C0", "0000FF", "750787"]],
    ["philadelphia", "Philadelphia", ["000000", "784F17", "E40303", "FF8C00", "FFED00", "008026", "004DFF", "750787"]],
    ["progress", "Progress", ["E40303", "FF8C00", "FFED00", "008026", "004DFF", "750787"]],
    ["intersex-progress", "Intersex-inclusive Progress", ["E40303", "FF8C00", "FFED00", "008026", "004DFF", "750787"]],
    ["transgender", "Transgender", ["5BCEFA", "F5A9B8", "FFFFFF", "F5A9B8", "5BCEFA"]],
    ["bisexual", "Bisexual", ["D60270", "9B4F96", "0038A8"]],
    ["pansexual", "Pansexual", ["FF218C", "FFD800", "21B1FF"]],
    ["lesbian-five", "Lesbian (five stripes)", ["D52D00", "FF9A56", "FFFFFF", "D162A4", "A30262"]],
    ["lesbian-seven", "Lesbian (seven stripes)", ["D52D00", "EF7627", "FF9A56", "FFFFFF", "D162A4", "B55690", "A30262"]],
    ["gay-five", "Gay men (five stripes)", ["078D70", "98E8C1", "FFFFFF", "7BADE2", "3D1A78"]],
    ["gay-seven", "Gay men (seven stripes)", ["078D70", "26CEAA", "98E8C1", "FFFFFF", "7BADE2", "5049CC", "3D1A78"]],
    ["asexual", "Asexual", ["000000", "A3A3A3", "FFFFFF", "800080"]],
    ["aromantic", "Aromantic", ["3DA542", "A7D379", "FFFFFF", "A9A9A9", "000000"]],
    ["aroace", "Aroace (sunset)", ["D29023", "E5CC32", "FFFFFF", "7AADDA", "273855"]],
    ["agender", "Agender", ["000000", "B9B9B9", "FFFFFF", "B8F483", "FFFFFF", "B9B9B9", "000000"]],
    ["nonbinary", "Nonbinary", ["FFF430", "FFFFFF", "9C59D1", "000000"]],
    ["genderqueer", "Genderqueer", ["B57EDC", "FFFFFF", "4A8123"]],
    ["genderfluid", "Genderfluid", ["FF75A2", "FFFFFF", "BE18D6", "000000", "333EBD"]],
    ["demiboy", "Demiboy", ["7F7F7F", "C4C4C4", "9AD9EA", "FFFFFF", "9AD9EA", "C4C4C4", "7F7F7F"]],
    ["demigirl", "Demigirl", ["7F7F7F", "C4C4C4", "FFAEC9", "FFFFFF", "FFAEC9", "C4C4C4", "7F7F7F"]],
    ["demigender", "Demigender", ["7F7F7F", "C2C2C2", "FFE111", "FFFFFF", "FFE111", "C2C2C2", "7F7F7F"]],
    ["demisexual", "Demisexual", ["FFFFFF", "800080", "A3A3A3"]],
    ["demiromantic", "Demiromantic", ["FFFFFF", "3DA542", "A3A3A3"]],
    ["gray-asexual", "Gray-asexual", ["740194", "A3A3A3", "FFFFFF", "A3A3A3", "740194"]],
    ["grayromantic", "Grayromantic", ["3DA542", "A3A3A3", "FFFFFF", "A3A3A3", "3DA542"]],
    ["polysexual", "Polysexual", ["F61CB9", "07D569", "1C92F6"]],
    ["omnisexual", "Omnisexual", ["FF9ACE", "FF53BF", "200044", "6760FE", "8EA6FF"]],
    ["intersex", "Intersex", ["FFD800"]],
    ["abrosexual", "Abrosexual", ["74C892", "B3E2C9", "FFFFFF", "E493B3", "D84370"]],
    ["unlabeled", "Unlabeled", ["E7F9E3", "FDFDFB", "DDEFF7", "FAE1C2"]],
    ["neutrois", "Neutrois", ["FFFFFF", "24AE4D", "000000"]],
    ["androgyne", "Androgyne", ["FD027F", "9832FF", "00B8E7"], { vertical: true }],
    ["abroromantic", "Abroromantic", ["8DCB9B", "BFE4CF", "FFFFFF", "DD9BD8", "CA5473"], romantic],
    ["aceflux", "Aceflux", ["C62253", "C12678", "C0279A", "A928AC", "8C26AE"]],
    [
        "ambiamorous",
        "Ambiamorous",
        ["4848C2", "39398B", "2B2B55", "1E1E1E", "542D2D", "8B3B3B", "C14A4A"],
        {
            sizes: [20, 10, 10, 20, 10, 10, 20],
            symbol: '<path d="M20.6 15.4C19.7 19 18.5 20.6 16.6 20.6C15.1 20.6 14.3 19.4 14.3 18C14.3 16.6 15.1 15.4 16.6 15.4C18.5 15.4 19.7 17 20.6 20.6" fill="none" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round"/>',
        },
    ],
    ["androromantic", "Androromantic", ["5ECBF9", "634133", "B69FD3"], romantic],
    ["aporagender", "Aporagender", ["F37CCA", "E1BDF0", "FFF982", "E1BDF0", "7BBBDD"]],
    ["aroflux", "Aroflux", ["E7516A", "D86D65", "B7A55D", "A3C95A", "92E454"]],
    ["bigender", "Bigender", ["ED78AA", "FDF44D", "FFFFFF", "AE6DBE", "719EE3"]],
    ["biromantic", "Biromantic", ["D50071", "755299", "144391"], { sizes: [40, 20, 40], symbol: `<path d="${heart(1.8, 6.4, 8.4, 7.8)}" fill="#CCCCCC"/>` }],
    ["ceteroromantic", "Ceteroromantic", ["F7F401", "208903", "ED52E2", "F7F7F7", "000000"]],
    ["ceterosexual", "Ceterosexual", ["FCF980", "169C47", "FFFFFF", "000000"]],
    ["demifluid", "Demifluid", ["7F7F7F", "C3C3C3", demifluid, "FFFFFF", demifluid, "C3C3C3", "7F7F7F"]],
    [
        "diamoric",
        "Diamoric",
        ["91F291", "FFFFFF", "91F291"],
        {
            symbol: `${[0, 72, 144, 216, 288].map((angle) => `<circle cx="${number(18 + Math.sin((angle * Math.PI) / 180) * 1.9)}" cy="${number(18 - Math.cos((angle * Math.PI) / 180) * 1.9)}" r="1.7" fill="#66023C"/>`).join("")}<circle cx="18" cy="18" r=".9" fill="#FFFF00"/>`,
        },
    ],
    ["egogender", "Egogender", ["000000", "F8FF71", "FFFFFF", "FBDE3C"]],
    ["frayromantic", "Frayromantic", ["636363", "BABABA", "FFFFFF", "93E7D1", "226C90"]],
    ["gender-neutral", "Gender neutral", ["FFF433", "FFFFFF", "C0F68E", "21B14C"]],
    [
        "gender-questioning",
        "Gender questioning",
        ["FF98BA", "FA638F", "E0B6E0", "C0F68E", "DCDCDC", "FCF791", "91DFFF", "04ADEB", "6AD1D6"],
        { sizes: [20, 5, 25 / 3, 20 / 3, 20, 20 / 3, 25 / 3, 5, 20] },
    ],
    ["graygender", "Graygender", ["BFBEBE", "FFFFFF", "072384", "FFFFFF", "515151"], { sizes: [29, 6.5, 29, 6.5, 29] }],
    ["gyneromantic", "Gyneromantic", ["EAB0C3", "8A4D3B", "709950"], romantic],
    ["hijra", "Hijra", ["FFCCE6", "FFFFFF", "C10000", "FFFFFF", "B9E0FB"], { sizes: [34, 11, 10, 11, 34] }],
    [
        "intergender",
        "Intergender",
        ["900DC2", "FFE54F", "900DC2"],
        {
            sizes: [37.5, 25, 37.5],
            symbol: '<circle cx="18" cy="18" r="8.4" fill="none" stroke="#FFFFFF" stroke-width="2.3"/>',
        },
    ],
    ["maverique", "Maverique", ["FFF433", "FFFFFF", "F49622"]],
    ["mogai", "MOGAI", ["FFFFFF"], { symbol: mogai }],
    ["multigender", "Multigender", ["3F47CD", "00A3E8", "FA7F27", "00A3E8", "3F47CD"]],
    ["multisexual", "Multisexual", ["724DC9", "FFFFFF", "9EEFFF", "FF3D9B"]],
    [
        "neurogender",
        "Neurogender",
        ["DE2D48", "BEDA57", "B1F3DE", "942D98"],
        {
            vertical: true,
            symbol: '<path d="M18 18C21.5 13.5 24 11.2 27.4 11.2C31.2 11.2 33.6 14.2 33.6 18C33.6 21.8 31.2 24.8 27.4 24.8C24 24.8 21.5 22.5 18 18C14.5 13.5 12 11.2 8.6 11.2C4.8 11.2 2.4 14.2 2.4 18C2.4 21.8 4.8 24.8 8.6 24.8C12 24.8 14.5 22.5 18 18Z" fill="none" stroke="#393939" stroke-width="2.6"/>',
        },
    ],
    ["omniromantic", "Omniromantic", ["F2A4CF", "EC68BE", "2A034E", "6E66F6", "9AAAF9"], romantic],
    ["pangender", "Pangender", ["FFF798", "FEDDCD", "FFEBFB", "FFFFFF", "FFEBFB", "FEDDCD", "FFF798"]],
    ["panromantic", "Panromantic", ["E5318A", "FED905", "4AAAE0"], romantic],
    ["polygender", "Polygender", ["000000", "939393", "ED94C5", "F5ED81", "64BBE6"]],
    ["polyromantic", "Polyromantic", ["C84793", "4BB166", "4288C8"], romantic],
    ["pomosexual", "Pomosexual", ["FFAEC9", "FFC6DE", "FFFFFF", "E8CDFF", "FFFFFF", "FFC6DE", "FFAEC9"]],
    ["transneutral", "Transneutral", ["74DFFF", "FFFDB3", "FFFC75", "FFF200", "FFFC75", "FFFDB3", "FE8CBF"]],
    ["trigender", "Trigender", ["FF95C5", "9581FF", "67D966", "9581FF", "FF95C5"]],
    [
        "two-spirit",
        "Two-spirit",
        ["E40303", "FF8C00", "FFED00", "008026", "004DFF", "750787"],
        {
            symbol: `${feather(14)}${feather(-14)}<circle cx="18" cy="9.6" r="2.6" fill="#FFFFFF" stroke="#000000" stroke-width=".5"/>`,
        },
    ],
    ["waria", "Waria", ["CE1127", "000000", "FDAFC5", "FBC02D", "613813", "FFFFFF"]],
    [
        "xenogender",
        "Xenogender",
        ["FF6691", "FF9997", "FFB782", "FBFFA6", "84BBFF", "9C84FF", "A317FF"],
        {
            symbol: '<path d="M10.6 23.4A7.4 7.4 0 0 1 25.4 23.4M13.2 23.4A4.8 4.8 0 0 1 22.8 23.4" fill="none" stroke="#FFFFFF" stroke-width="1.2"/><path d="M18 19.5L18.55 20.75L19.9 20.88L18.88 21.78L19.18 23.1L18 22.4L16.82 23.1L17.12 21.78L16.1 20.88L17.45 20.75Z" fill="#FFFFFF"/>',
        },
    ],
];

const root = path.resolve(__dirname, "..");
const check = process.argv.includes("--check");
const vendor = path.join(root, "assets", "badge-icons", "twemoji-flags");
const manifest = JSON.parse(fs.readFileSync(path.join(vendor, "manifest.json"), "utf8"));
const upstreamSlugs = new Set(manifest.flags.map((flag) => flag.slug));
const template = fs.readFileSync(path.join(vendor, "flags", manifest.template.file), "utf8");
if (createHash("sha256").update(template).digest("hex") !== manifest.template.sha256) throw new Error("Vendored template checksum mismatch");
const silhouette = template.match(/\bd="([^"]+)"/)[1];
let stale = 0;
for (const [slug, title, colors, options = {}] of flags) {
    if (upstreamSlugs.has(slug)) continue;
    const parts = [];
    const gradients = [];
    let symbol = options.symbol ?? "";
    const sizes = options.sizes ?? (slug === "bisexual" ? [40, 20, 40] : ["demisexual", "demiromantic"].includes(slug) ? [37.5, 25, 37.5] : colors.map(() => 100 / colors.length));
    let offset = 0;
    for (const [index, color] of colors.entries()) {
        const fill = Array.isArray(color)
            ? (() => {
                  gradients.push(
                      `<linearGradient id="stripe${index}">${color.map((stop, i) => `<stop offset="${number(i / (color.length - 1))}" stop-color="#${stop}"/>`).join("")}</linearGradient>`,
                  );
                  return `url(#stripe${index})`;
              })()
            : `#${color}`;
        parts.push(
            options.vertical
                ? `<rect x="${number(offset * 1.5)}" width="${number(150 - offset * 1.5)}" height="100" fill="${fill}"/>`
                : `<rect y="${number(offset)}" width="150" height="${number(100 - offset)}" fill="${fill}"/>`,
        );
        offset += sizes[index];
    }
    if (["demisexual", "demiromantic"].includes(slug)) parts.push('<path d="M0 0L65 50L0 100Z" fill="#000000"/>');
    if (["progress", "intersex-progress"].includes(slug)) {
        const inclusive = slug === "intersex-progress";
        const tips = inclusive ? [83.4, 74.2, 65, 55.8, 46.6, 37.4] : [72, 60, 48, 36, 24];
        const chevronColors = ["000000", "784F17", "5BCEFA", "F5A9B8", "FFFFFF", "FFD800"];
        tips.forEach((tip, index) => {
            const span = tip * (inclusive ? 17 / 15 : 25 / 24);
            parts.push(`<path d="M0 ${number(50 - span)}L${tip} 50L0 ${number(50 + span)}Z" fill="#${chevronColors[index]}"/>`);
        });
        if (inclusive) symbol = '<circle cx="3.24" cy="18" r="2.4" fill="none" stroke="#7902AA" stroke-width="0.552"/>';
    }
    if (slug === "intersex") parts.push('<circle cx="75" cy="50" r="24.5" fill="none" stroke="#7902AA" stroke-width="8.9375"/>');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" role="img"><title>${title}</title><defs><clipPath id="flag"><path d="${silhouette}"/></clipPath>${gradients.join("")}</defs><g clip-path="url(#flag)"><g transform="translate(0 5) scale(.24 .26)">${parts.join("")}</g>${symbol}</g></svg>\n`;
    const file = path.join(root, "assets", "badge-icons", `pride_${slug.replaceAll("-", "_")}.svg`);
    if (check) {
        if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== svg) {
            console.error(`Out of date: ${path.relative(root, file)}`);
            stale++;
        }
    } else fs.writeFileSync(file, svg);
}
for (const flag of manifest.flags) {
    const source = fs.readFileSync(path.join(vendor, "flags", flag.file));
    if (createHash("sha256").update(source).digest("hex") !== flag.sha256) throw new Error(`Vendored artwork checksum mismatch: ${flag.file}`);
    const file = path.join(root, "assets", "badge-icons", `${flag.icon}.svg`);
    if (check) {
        if (!fs.existsSync(file) || !source.equals(fs.readFileSync(file))) {
            console.error(`Out of date: ${path.relative(root, file)}`);
            stale++;
        }
    } else fs.writeFileSync(file, source);
}
const supplemental = flags
    .filter(([slug]) => !upstreamSlugs.has(slug))
    .map(([slug]) => {
        const icon = `pride_${slug.replaceAll("-", "_")}`;
        return {
            slug,
            icon,
            sha256: createHash("sha256")
                .update(fs.readFileSync(path.join(root, "assets", "badge-icons", `${icon}.svg`)))
                .digest("hex"),
            derivedFrom: manifest.template.file,
        };
    });
const supplementalSlugs = supplemental.map((flag) => flag.slug);
if (check) {
    if (JSON.stringify(supplemental) !== JSON.stringify(manifest.supplementalFlags) || JSON.stringify(supplementalSlugs) !== JSON.stringify(manifest.supplementalSlugs)) {
        console.error("Supplemental artwork manifest is out of date");
        stale++;
    }
} else {
    manifest.supplementalSlugs = supplementalSlugs;
    manifest.supplementalFlags = supplemental;
    fs.writeFileSync(path.join(vendor, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`);
}
if (stale) process.exitCode = 1;
else console.log(`${check ? "Verified" : "Generated"} ${manifest.flags.length} Twemoji flags and ${supplemental.length} supplemental badge SVGs.`);
