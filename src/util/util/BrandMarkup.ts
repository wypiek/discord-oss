export const INSTANCE_ICON_PATH =
    "M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z";
export const INSTANCE_ICON_WIDTH = 127.14;
export const INSTANCE_ICON_HEIGHT = 96.36;

export const BRAND_COLOR = "#3BA3E8";

const round = (n: number) => Math.round(n * 1000) / 1000;

export const glyphMarkup = (x: number, y: number, size: number, fill: string) => {
    const scale = size / INSTANCE_ICON_WIDTH;
    const top = y + (size - INSTANCE_ICON_HEIGHT * scale) / 2;
    return `<path fill="${fill}" transform="translate(${round(x)} ${round(top)}) scale(${round(scale)})" d="${INSTANCE_ICON_PATH}"/>`;
};

const GLYPH_INSET = 0.1992;

export const iconBodyMarkup = (size: number, background = BRAND_COLOR) =>
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${background}"/>${glyphMarkup(size * GLYPH_INSET, size * GLYPH_INSET, size * (1 - 2 * GLYPH_INSET), "#fff")}`;

export const iconSvg = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${iconBodyMarkup(size)}</svg>`;

export const APP_THEME_COLOR = "#121214";

export const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const iconTileMarkup = (iconUrl: string | null) =>
    iconUrl ? `<img class="brand-icon" src="${escapeXml(iconUrl)}" alt="" />` : `<svg class="brand-icon" viewBox="0 0 48 48" aria-hidden="true">${iconBodyMarkup(48)}</svg>`;

export const logoMarkup = (name: string, iconUrl: string | null, logoUrl: string | null) =>
    logoUrl
        ? `<img class="brand-logo" src="${escapeXml(logoUrl)}" alt="${escapeXml(name)}" />`
        : `<span class="brand-lockup">${iconTileMarkup(iconUrl)}<span class="brand-name">${escapeXml(name)}</span></span>`;

const WORDMARK_FONT_SIZE = 100;

const wordmarkAdvance = (char: string) => {
    if (/[iljtfI1.,'!:;|]/.test(char)) return 44;
    if (/[mwMW]/.test(char)) return 117;
    if (/[A-Z]/.test(char)) return 85;
    if (/[a-z]/.test(char)) return 76;
    if (/[0-9]/.test(char)) return 70;
    if (char === " ") return 26;
    return 84;
};

export const footerWordmarkMarkup = (name: string, logoUrl: string | null = null) => {
    if (logoUrl) return `<img class="footer-word-logo" src="${escapeXml(logoUrl)}" alt="" />`;
    const width = Math.max(1, Math.round([...name].reduce((total, char) => total + wordmarkAdvance(char), 0)));
    return `<svg class="footer-word-text" viewBox="0 0 ${width} 96" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><text x="0" y="74" textLength="${width}" lengthAdjust="spacing" font-size="${WORDMARK_FONT_SIZE}" fill="currentColor">${escapeXml(name)}</text></svg>`;
};

export const brandPageMarkup = (html: string, name: string, iconUrl: string | null, logoUrl: string | null = null) =>
    html
        .replaceAll("__INSTANCE_WORDMARK__", footerWordmarkMarkup(name, logoUrl))
        .replaceAll("__INSTANCE_LOGO__", logoMarkup(name, iconUrl, logoUrl))
        .replaceAll("__INSTANCE_NAME__", escapeXml(name))
        .replaceAll("__INSTANCE_ICON__", iconTileMarkup(iconUrl));

const iconMarkup = (x: number, y: number, size: number, iconUri: string | null) =>
    iconUri ? `<image href="${escapeXml(iconUri)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>` : glyphMarkup(x, y, size, "#fff");

export const wordmarkMarkup = (name: string, box?: [number, number], iconUri: string | null = null) => {
    const width = Math.ceil(34 + [...name].length * 12.5);
    const [boxWidth, boxHeight] = box ?? [width, 24];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${boxWidth}" height="${boxHeight}" viewBox="0 0 ${width} 24" fill="none">${iconMarkup(0, 0, 24, iconUri)}<text x="32" y="19.5" fill="#fff" font-family="'gg sans','Noto Sans','Helvetica Neue',Helvetica,Arial,sans-serif" font-size="20" font-weight="800">${escapeXml(name)}</text></svg>`;
};

export const qrLogoSvg = (iconUri: string | null = null) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000"/>${iconMarkup(23, 23, 54, iconUri)}</svg>`;

export const placeholderAvatarSvg = (size: number, background: string, foreground: string, iconUri: string | null = null) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256"><circle cx="128" cy="128" r="128" fill="${background}"/>${
        iconUri
            ? `<image href="${escapeXml(iconUri)}" x="62" y="62" width="132" height="132" preserveAspectRatio="xMidYMid meet" opacity="0.6"/>`
            : glyphMarkup(62, 62, 132, foreground)
    }</svg>`;

export const BRANDED_CLIENT_ASSETS: Record<string, { wordmark?: boolean; svg: (name: string, iconUri: string | null) => string }> = {
    "131c318dd45b7aa4.svg": { wordmark: true, svg: (name, iconUri) => wordmarkMarkup(name, undefined, iconUri) },
    "bbbc3d376d38e7bc.svg": { wordmark: true, svg: (name, iconUri) => wordmarkMarkup(name, [112, 36], iconUri) },
    "dd05fd1ea37e7747.png": { svg: (name, iconUri) => qrLogoSvg(iconUri) },
    "d11a9f2f62494f22.png": {
        svg: (name, iconUri) => placeholderAvatarSvg(132, "rgb(116 126 136 / 30%)", "rgb(255 255 255 / 30%)", iconUri),
    },
    "9d8606c1376ca484.png": {
        svg: (name, iconUri) => placeholderAvatarSvg(128, "rgb(170 170 178 / 80%)", "#fff", iconUri),
    },
    "2ca6b6f4a73913ed.png": {
        svg: (name, iconUri) => placeholderAvatarSvg(128, "rgb(111 111 116 / 80%)", "rgb(191 191 193 / 90%)", iconUri),
    },
    "53728a8572402a56.png": {
        svg: (name, iconUri) => placeholderAvatarSvg(396, "#0c0d0e", "#444545", iconUri),
    },
};
