import { ImageIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";
import { React, RestAPI, useState } from "@webpack/common";
import { FosscordAuthor } from "../fosscordCore/shared";
import { SettingsSection } from "../fosscordCore/ui";

const storageKey = "fosscord.gifProvider";
let defaultProvider = "klipy";
let providers: Record<string, { available: boolean }> = {};
function selectedProvider() {
    const value = localStorage.getItem(storageKey);
    return value === "tenor" || value === "klipy" ? value : defaultProvider;
}
function ProviderSettings() {
    const [provider, setProvider] = useState(selectedProvider);
    return (
        <SettingsSection title="GIF search" description="Choose where GIF search results come from. Your choice is saved in this browser and applies to your next search.">
            <label htmlFor="fosscord-gif-provider" style={{ display: "block", marginTop: 16, color: "var(--text-default)", fontWeight: 600 }}>
                GIF provider
            </label>
            <select
                id="fosscord-gif-provider"
                value={provider}
                onChange={(event) => {
                    localStorage.setItem(storageKey, event.currentTarget.value);
                    setProvider(event.currentTarget.value);
                }}
                style={{
                    display: "block",
                    marginTop: 8,
                    width: "100%",
                    maxWidth: 320,
                    color: "var(--text-default)",
                    background: "var(--background-base-low)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    minHeight: 36,
                    padding: "0 8px",
                }}
            >
                <option value="klipy">Klipy{providers.klipy?.available ? "" : " (setup needed)"}</option>
                <option value="tenor">Tenor</option>
            </select>
            {!providers.klipy?.available && (
                <p style={{ color: "var(--text-muted)" }}>An instance administrator needs to configure a Klipy API key before Klipy searches are available.</p>
            )}
        </SettingsSection>
    );
}
export default definePlugin({
    name: "FosscordGifs",
    description: "Choose Klipy or Tenor in Settings using this instance's GIF service.",
    authors: [FosscordAuthor],
    required: true,
    dependencies: ["Settings"],
    patches: [
        {
            find: '"GIF_PICKER_TRENDING_FETCH_SUCCESS",trendingCategories:',
            replacement: {
                match: /(GIFS_(?:SEARCH|SUGGEST|TRENDING|TRENDING_GIFS),query:\{)/g,
                replace: "$1provider:$self.provider(),",
            },
        },
    ],
    provider: selectedProvider,
    async start() {
        SettingsPlugin.customEntries.push({
            key: "fosscord_gifs",
            title: "GIFs",
            Component: ProviderSettings,
            Icon: ImageIcon,
        });
        try {
            const { body } = await RestAPI.get({ url: "/gifs/providers" });
            providers = body.providers || {};
            if (body.defaultProvider === "tenor" || body.defaultProvider === "klipy") defaultProvider = body.defaultProvider;
        } catch {}
    },
    stop() {
        removeFromArray(SettingsPlugin.customEntries, (entry) => entry.key === "fosscord_gifs");
    },
});
