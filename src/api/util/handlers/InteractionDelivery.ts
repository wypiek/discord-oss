import { getAjv, InteractionCallbacksSchema } from "@spacebar/schemas";
import { PendingInteraction, saveInteraction } from "@spacebar/util";
import { ensureInteractionKeys, postSignedInteraction } from "./Application";
import { emitInteractionFailure, processInteractionCallback } from "./Interaction";

export const INTERACTION_RESPONSE_WINDOW_MS = 3000;

export async function deliverOverHttp(applicationId: string, url: string, interaction: PendingInteraction, payload: unknown, deadline: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Interaction response window closed")), Math.max(0, deadline - Date.now()));
    const expired = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
    expired.catch(() => {});
    const within = <T>(work: Promise<T>) => Promise.race([work, expired]);
    try {
        const key = await within(ensureInteractionKeys(applicationId));
        const res = await within(
            postSignedInteraction(url, key, payload, undefined, applicationId, {
                signal: controller.signal,
                timeoutMs: Math.min(INTERACTION_RESPONSE_WINDOW_MS, Math.max(1, Math.ceil(deadline - Date.now()))),
            }),
        );
        if (!res.ok) throw new Error(`endpoint returned ${res.status}`);
        const callback = (await within(res.json())) as InteractionCallbacksSchema;
        const validate = getAjv().getSchema("InteractionCallbacksSchema");
        if (validate && !validate(callback)) throw new Error("endpoint returned an invalid interaction response");
        if (interaction.acknowledged) return;
        controller.signal.throwIfAborted();
        await processInteractionCallback(interaction, callback);
    } catch (error) {
        const late = controller.signal.aborted;
        console.error(`[Interactions] HTTP delivery for application ${applicationId} failed:`, late ? "deadline" : ((error as { code?: unknown })?.code ?? "transport failure"));
        if (interaction.acknowledged || late) return;
        interaction.failureSent = true;
        await saveInteraction(interaction).catch(() => {});
        await emitInteractionFailure(interaction).catch(() => {});
    } finally {
        clearTimeout(timer);
    }
}
