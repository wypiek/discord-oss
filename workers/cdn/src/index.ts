import type { CdnEnv } from "./env";
import { handleCdn } from "./media";

export default {
    async fetch(request, env, ctx) {
        const response = await handleCdn(request, env, ctx);
        if (response) return response;
        if (env.API) return env.API.fetch(request);
        return new Response("not found", { status: 404 });
    },
} satisfies ExportedHandler<CdnEnv>;
