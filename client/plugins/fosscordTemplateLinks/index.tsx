import definePlugin from "@utils/types";
import type { JSX } from "react";
import { GuildStore, NavigationRouter, RestAPI, Text, TextInput, useState } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

interface TemplatePreview {
    code: string;
    name: string;
    description: string | null;
    usage_count?: number;
    serialized_source_guild: { name?: string; roles: unknown[]; channels: { type: number }[] };
}

type ClientButton = (props: { variant?: string; text: string; onClick: () => void; disabled?: boolean; loading?: boolean; fullWidth?: boolean }) => JSX.Element;

// a template code from what was pasted: discord.new/<code>, discord.com/template/<code>, <instance>/template/<code> or the bare code
function templateCode(input: string) {
    const value = input.trim();
    const link = value.match(/(?:discord\.new|\/template)\/([\w-]+)/i);
    const code = link ? link[1] : value;
    return /^[\w-]{2,64}$/.test(code) ? code : null;
}

const errorMessage = (error: unknown, fallback: string) => (error as { body?: { message?: string } })?.body?.message || fallback;

// wait for the gateway to deliver the new server before opening it
async function openGuild(guildId: string, channelId?: string | null) {
    for (let i = 0; i < 30 && !GuildStore.getGuild(guildId); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    NavigationRouter.transitionTo(`/channels/${guildId}${channelId ? `/${channelId}` : ""}`);
}

function TemplateLink({ Button, onClose }: { Button: ClientButton; onClose?: () => void }) {
    const [link, setLink] = useState("");
    const [template, setTemplate] = useState<TemplatePreview | null>(null);
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = async () => {
        const code = templateCode(link);
        if (!code) return setError("Paste a template link, like https://discord.new/abc123");
        setBusy(true);
        setError(null);
        try {
            const { body } = await RestAPI.get({ url: `/guilds/templates/${encodeURIComponent(code)}` });
            setTemplate({ ...body, code });
            setName(body.serialized_source_guild?.name || body.name);
        } catch (e) {
            setError(errorMessage(e, "That template couldn't be loaded."));
        } finally {
            setBusy(false);
        }
    };

    const create = async () => {
        if (!template) return;
        setBusy(true);
        setError(null);
        try {
            const { body } = await RestAPI.post({
                url: `/guilds/templates/${encodeURIComponent(template.code)}`,
                body: { name: name.trim() || template.name },
            });
            onClose?.();
            await openGuild(body.id, body.system_channel_id);
        } catch (e) {
            setError(errorMessage(e, "The server couldn't be created from this template."));
            setBusy(false);
        }
    };

    const source = template?.serialized_source_guild;
    const channels = source?.channels.filter((channel) => channel.type !== 4).length ?? 0;
    const categories = source?.channels.filter((channel) => channel.type === 4).length ?? 0;
    const roles = Math.max(0, (source?.roles.length ?? 1) - 1);

    return (
        <div className="fosscord-template-link">
            <Text variant="heading-lg/semibold" color="text-strong">
                Have a template link?
            </Text>
            {template ? (
                <>
                    <div className="fosscord-template-preview">
                        <Text variant="text-md/semibold" color="text-strong">
                            {template.name}
                        </Text>
                        {template.description && (
                            <Text variant="text-sm/normal" color="text-muted">
                                {template.description}
                            </Text>
                        )}
                        <Text variant="text-xs/normal" color="text-muted">
                            {[
                                `${channels} channel${channels === 1 ? "" : "s"}`,
                                categories && `${categories} categor${categories === 1 ? "y" : "ies"}`,
                                roles && `${roles} role${roles === 1 ? "" : "s"}`,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </Text>
                    </div>
                    <TextInput value={name} onChange={setName} placeholder="Server name" maxLength={100} />
                    <div className="fosscord-template-actions">
                        <Button variant="secondary" text="Back" onClick={() => (setTemplate(null), setError(null))} disabled={busy} />
                        <Button variant="primary" text="Create Server" onClick={create} loading={busy} disabled={busy} />
                    </div>
                </>
            ) : (
                <div className="fosscord-template-actions">
                    <TextInput value={link} onChange={(value: string) => (setLink(value), setError(null))} placeholder="https://discord.new/..." />
                    <Button variant="secondary" text="Load" onClick={load} loading={busy} disabled={busy || !link.trim()} />
                </div>
            )}
            {error && (
                <Text variant="text-sm/normal" color="text-feedback-critical">
                    {error}
                </Text>
            )}
        </div>
    );
}

export default definePlugin({
    name: "FosscordTemplateLinks",
    description: "Lets the create server popup make a server from a template link, including discord.new links, which the server loads from Discord.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    renderTemplateLink: (props: { Button: ClientButton; onClose?: () => void }) => <TemplateLink {...props} />,

    patches: [
        {
            // the create server popup's first step, whose footer offers "Join a Server" for an invite
            find: /onChooseTemplate:\i,onJoin:\i\}=/,
            replacement: {
                match: /(onClose:(\i),onChooseTemplate:\i,onJoin:\i\}=\i[\s\S]{0,3000}?"data-button-hoisted-classname-wrapper":!0,className:\i\.\i,children:\(0,\i\.jsx\)\((\i\.\$),\{variant:"secondary",fullWidth:!0,text:[^}]+?,onClick:\i\}\)\}\))/,
                replace: "$1,$self.renderTemplateLink({Button:$3,onClose:$2})",
            },
        },
    ],
});
