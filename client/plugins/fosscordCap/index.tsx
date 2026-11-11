import definePlugin, { StartAt } from "@utils/types";
import { React, RestAPI, useEffect, useRef, useState } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

type CapConfiguration = { service?: string; endpoint?: string; register?: boolean };
type CapElement = HTMLElement & { reset(): void };
type CapController = {
    takeToken(): string | undefined;
    rejectToken(): void;
    registrationInterrupted(): void;
    registrationRateLimited(seconds: number): void;
};
let current: CapController | undefined;
let registrationRequest: ReturnType<typeof RestAPI.post> | undefined;

function registerAccount(api: Pick<typeof RestAPI, "post">, options: Parameters<typeof RestAPI.post>[0]) {
    if (registrationRequest) return registrationRequest;
    const controller = current;
    const request = api.post({ ...options, retries: 0 }).then(
        (response) => {
            if (response.status >= 200 && response.status <= 299 && (typeof response.body?.token !== "string" || !response.body.token.trim())) {
                throw interruptedRegistrationError({ status: response.status });
            }
            return response;
        },
        (error: unknown) => {
            if (registrationResultUnknown(error)) throw interruptedRegistrationError(error);
            throw error;
        },
    );
    registrationRequest = request;
    const release = () => {
        if (registrationRequest === request) registrationRequest = undefined;
    };
    void request.then(release, (error: unknown) => {
        release();
        if (current !== controller) return;
        if (registrationResultUnknown(error)) controller?.registrationInterrupted();
        if (error && typeof error === "object" && "status" in error && error.status === 429) {
            const seconds = "body" in error && typeof error.body === "object" && error.body && "retry_after" in error.body ? Number(error.body.retry_after) : 60;
            controller?.registrationRateLimited?.(Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
        }
    });
    return request;
}

function interruptedRegistrationError(cause: unknown) {
    const message = "Account creation was interrupted. Use the recovery options above.";
    return Object.assign(new Error(message), { status: 0, body: { message }, cause });
}

function registrationResultUnknown(error: unknown): boolean {
    if (!error || typeof error !== "object" || !("status" in error)) return false;
    return (
        error.status === undefined ||
        error.status === null ||
        error.status === 0 ||
        (typeof error.status === "number" && ((error.status >= 200 && error.status <= 299) || (error.status >= 500 && error.status <= 599)))
    );
}

let widgetLoader: Promise<void> | undefined;

function loadWidget(): Promise<void> {
    if (customElements.get("cap-widget")) return Promise.resolve();
    if (widgetLoader) return widgetLoader;
    const globals = window as typeof window & Record<string, unknown>;
    globals.CAP_CUSTOM_WASM_URL = "/api/v9/auth/cap/cap_wasm_bg.wasm";
    globals.CAP_CUSTOM_HASHWX_URL = "/api/v9/auth/cap/hashwx.wasm";
    globals.CAP_PAKO_URL = "/api/v9/auth/cap/pako.js";
    globals.CAP_DISABLE_WIDGET_REF = true;
    widgetLoader = new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/api/v9/auth/cap/widget.js";
        const fail = () => {
            clearTimeout(deadline);
            script.onload = null;
            script.onerror = null;
            script.remove();
            widgetLoader = undefined;
            reject(new Error("Could not load verification."));
        };
        const deadline = setTimeout(fail, 15000);
        script.onload = () => {
            if (!customElements.get("cap-widget")) return fail();
            clearTimeout(deadline);
            script.onload = null;
            script.onerror = null;
            resolve();
        };
        script.onerror = fail;
        document.head.append(script);
    });
    return widgetLoader;
}

function SignupVerification() {
    const container = useRef<HTMLDivElement>(null);
    const verification = useRef<HTMLElement>(null);
    const [enabled, setEnabled] = useState(true);
    const [message, setMessage] = useState("Loading account verification…");
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [interrupted, setInterrupted] = useState(false);
    const [retryAt, setRetryAt] = useState(0);
    const [remaining, setRemaining] = useState(0);
    useEffect(() => {
        if (!retryAt) return;
        const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [retryAt]);
    useEffect(() => {
        let active = true;
        let token: string | undefined;
        let required = true;
        let ready = false;
        let widget: CapElement | undefined;
        const form = verification.current?.closest("form");
        const controller: CapController = {
            registrationRateLimited(seconds) {
                if (!active) return;
                setRemaining(Math.ceil(seconds));
                setRetryAt(Date.now() + seconds * 1000);
            },
            takeToken() {
                return token;
            },
            registrationInterrupted() {
                token = undefined;
                widget?.reset();
                setInterrupted(true);
            },
            rejectToken() {
                token = undefined;
                widget?.reset();
                setError("Verification expired or was already used. Verify again, then create your account.");
            },
        };
        current = controller;
        const blockUnverified = (event: Event) => {
            event.preventDefault();
            if (event.type === "submit") event.stopImmediatePropagation();
            setError(ready ? "Complete the verification before creating your account." : "Account verification is not ready. Wait or retry verification.");
            widget?.setAttribute("aria-invalid", "true");
            const button = widget?.shadowRoot?.querySelector<HTMLElement>("button, [role=button], [role=checkbox], input");
            if (button) button.focus();
            else container.current?.focus();
        };
        const onSubmit = (event: Event) => {
            if (!required || (ready && token)) return;
            blockUnverified(event);
        };
        form?.addEventListener("submit", onSubmit, true);
        RestAPI.get({ url: "/auth/captcha" })
            .then(async ({ body }: { body: CapConfiguration }) => {
                if (!active) return;
                required = body.register === true && body.service === "cap";
                setEnabled(required);
                if (!required) return;
                if (!body.endpoint) throw new Error("Verification endpoint is unavailable.");
                await loadWidget();
                if (!active || !container.current) return;
                widget = document.createElement("cap-widget") as CapElement;
                widget.addEventListener("invalid", blockUnverified);
                widget.setAttribute("data-cap-api-endpoint", body.endpoint);
                widget.setAttribute("required", "");
                widget.setAttribute("aria-label", "Required account verification");
                widget.setAttribute("aria-describedby", "fosscord-cap-status fosscord-cap-error");
                widget.setAttribute("data-cap-disable-haptics", "");
                widget.setAttribute("data-cap-worker-count", String(Math.max(1, Math.min(navigator.hardwareConcurrency || 2, matchMedia("(pointer: coarse)").matches ? 2 : 4))));
                widget.addEventListener("solve", (event) => {
                    token = (event as CustomEvent<{ token: string }>).detail.token;
                    widget?.removeAttribute("aria-invalid");
                    setError("");
                    setMessage("Verified. You can create your account.");
                });
                widget.addEventListener("reset", () => {
                    token = undefined;
                    widget?.shadowRoot?.querySelector('[part="trigger"]')?.setAttribute("aria-label", "Click to verify you're a human");
                    setMessage("Complete this verification to create your account.");
                });
                widget.addEventListener("error", () => {
                    token = undefined;
                    setError("Verification failed. Try the verification again.");
                });
                container.current.append(widget);
                ready = true;
                setMessage("Complete this verification to create your account.");
            })
            .catch(() => {
                if (active) {
                    setMessage("");
                    setError("Could not load account verification. Retry verification to continue.");
                }
            });
        return () => {
            active = false;
            form?.removeEventListener("submit", onSubmit, true);
            widget?.remove();
            if (current === controller) current = undefined;
        };
    }, [attempt]);
    useEffect(() => {
        const widget = container.current?.querySelector("cap-widget");
        const shadow = widget?.shadowRoot;
        const trigger = shadow?.querySelector('[part="trigger"]');
        if (!shadow || !trigger) return;
        let description = shadow.getElementById("fosscord-cap-description");
        if (!description) {
            description = document.createElement("span");
            description.id = "fosscord-cap-description";
            description.hidden = true;
            shadow.append(description);
        }
        description.textContent = `Account verification: ${[message, error].filter(Boolean).join(" ")}`;
        trigger.setAttribute("aria-describedby", description.id);
        if (error) {
            trigger.setAttribute("aria-invalid", "true");
            widget?.setAttribute("aria-invalid", "true");
        } else {
            trigger.removeAttribute("aria-invalid");
            widget?.removeAttribute("aria-invalid");
        }
    }, [message, error, attempt]);
    if (!enabled && !interrupted) return null;
    return (
        <section ref={verification} className="fosscord-cap-verification" aria-label={enabled ? "Account verification" : "Account creation"}>
            {enabled && (
                <>
                    <div className="fosscord-cap-label">
                        Account verification <span>Required</span>
                    </div>
                    <div ref={container} tabIndex={-1} className="fosscord-cap-container" />
                    <p id="fosscord-cap-status" role="status" aria-atomic="true">
                        {message}
                    </p>
                </>
            )}
            {retryAt > 0 && (
                <div className="fosscord-cap-recovery">
                    <p role="status" aria-atomic="true">
                        {remaining > 0
                            ? `Too many signup attempts. Retry in ${remaining >= 60 ? `${Math.ceil(remaining / 60)} minutes` : `${remaining} seconds`}. Your entered details are preserved.`
                            : "You can retry creating your account now. Your entered details are preserved."}
                    </p>
                    <button type="button" disabled={remaining > 0} onClick={() => verification.current?.closest("form")?.requestSubmit()}>
                        Retry signup
                    </button>
                </div>
            )}
            {interrupted && (
                <div className="fosscord-cap-recovery">
                    <p role="alert">
                        Account creation was interrupted. Your account may already exist. Sign in with the username and password you chose.
                        {enabled ? " If no account was created, verify again and retry signup." : " If no account was created, retry signup."}
                    </p>
                    <a href="/login">Sign in</a>
                </div>
            )}
            {enabled && error && (
                <p id="fosscord-cap-error" role="alert" aria-atomic="true">
                    {error}
                </p>
            )}
            {enabled && error && (
                <button
                    type="button"
                    onClick={() => {
                        setError("");
                        setMessage("Loading account verification…");
                        setAttempt(attempt + 1);
                    }}
                >
                    Retry verification
                </button>
            )}
        </section>
    );
}

export default definePlugin({
    name: "FosscordCap",
    description: "Require a visible, self-hosted Cap verification before creating an account.",
    authors: [FosscordAuthor],
    required: true,
    startAt: StartAt.DOMContentLoaded,
    managedStyle,
    withWidget: (consent: React.ReactNode) => (
        <>
            <SignupVerification />
            {consent}
        </>
    ),
    takeToken: () => current?.takeToken(),
    register: registerAccount,
    handleChallenge(body: { captcha_service?: string } | undefined) {
        if (body?.captcha_service !== "cap" || !current) return false;
        current.rejectToken();
        return true;
    },
    patches: [
        {
            find: "interceptResponse(",
            replacement: {
                match: /interceptResponse\((\i),(\i),(\i)\)\{/,
                replace: "$&if($self.handleChallenge($1.body))return!1;",
            },
        },
        {
            find: "REGISTER_PROMO_EMAIL_CHECKBOX_WEB",
            replacement: [
                {
                    match: /function (\i)\((\i)\)\{let\{consent:(\i),consentRequired:(\i),onConsentChange:(\i)\}=\2;/,
                    replace: "function $1($2){return $self.withWidget($1CapConsent($2))}function $1CapConsent($2){let{consent:$3,consentRequired:$4,onConsentChange:$5}=$2;",
                },
                {
                    match: /(url:\i\.\i\.REGISTER,body:\{)/,
                    replace: "$1captcha_key:$self.takeToken(),",
                },
                {
                    match: /(\i\.\i)\.post\((\{url:\i\.\i\.REGISTER,body:\{)/,
                    replace: "$self.register($1,$2",
                },
            ],
        },
    ],
});
