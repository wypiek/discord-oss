export const INSTANCE_ICON_PATH =
    "M2.5 9.5C2.5 7.5 3 4.5 4.2 3.2C4.8 2.6 5.6 2.7 6.1 3.2L8.6 5.8C10.8 5.3 13.2 5.3 15.4 5.8L17.9 3.2C18.4 2.7 19.2 2.6 19.8 3.2C21 4.5 21.5 7.5 21.5 9.5L21.5 13.5C21.5 18.2 17.5 20.8 12 20.8C6.5 20.8 2.5 18.2 2.5 13.5ZM6.5 13a1.9 2.5 0 1 0 3.8 0a1.9 2.5 0 1 0 -3.8 0ZM13.7 13a1.9 2.5 0 1 0 3.8 0a1.9 2.5 0 1 0 -3.8 0Z";
export const INSTANCE_WHISKERS_PATH =
    "M3.779 14.08L0.879 13.08A0.55 0.55 0 0 0 0.521 14.12L3.421 15.12A0.55 0.55 0 0 0 3.779 14.08ZM3.444 16.073L0.744 16.873A0.55 0.55 0 0 0 1.056 17.927L3.756 17.127A0.55 0.55 0 0 0 3.444 16.073ZM20.579 15.12L23.479 14.12A0.55 0.55 0 0 0 23.121 13.08L20.221 14.08A0.55 0.55 0 0 0 20.579 15.12ZM20.244 17.127L22.944 17.927A0.55 0.55 0 0 0 23.256 16.873L20.556 16.073A0.55 0.55 0 0 0 20.244 17.127Z";

export const BRAND_COLOR = "#7B5CFF";

export const APP_THEME_COLOR = "#121214";

export const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const iconTileMarkup = (iconUrl: string | null) =>
    iconUrl
        ? `<img class="brand-icon" src="${escapeXml(iconUrl)}" alt="" />`
        : `<svg class="brand-icon" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="15" fill="${BRAND_COLOR}"/><g transform="translate(6 6) scale(1.5)" fill="#fff"><path fill-rule="evenodd" d="${INSTANCE_ICON_PATH}"/><path d="${INSTANCE_WHISKERS_PATH}"/></g></svg>`;

export const brandPageMarkup = (html: string, name: string, iconUrl: string | null) =>
    html.replaceAll("__INSTANCE_NAME__", escapeXml(name)).replaceAll("__INSTANCE_ICON__", iconTileMarkup(iconUrl));

const iconMarkup = (x: number, y: number, size: number, iconUri: string | null) =>
    iconUri
        ? `<image href="${escapeXml(iconUri)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`
        : `<g fill="#fff" transform="translate(${x} ${y}) scale(${size / 24})"><path fill-rule="evenodd" d="${INSTANCE_ICON_PATH}"/><path d="${INSTANCE_WHISKERS_PATH}"/></g>`;

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
            : `<g fill="${foreground}" transform="translate(62 62) scale(5.5)"><path fill-rule="evenodd" d="${INSTANCE_ICON_PATH}"/><path d="${INSTANCE_WHISKERS_PATH}"/></g>`
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
