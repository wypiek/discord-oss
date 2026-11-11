export class IntegrationConfiguration {
    gifs: GifIntegrationConfiguration = new GifIntegrationConfiguration();
}

export class GifIntegrationConfiguration {
    enabled: boolean = true;
    defaultProvider: "klipy" | "tenor" = "klipy";
    klipy: GenericGifIntegrationConfiguration = Object.assign(new GenericGifIntegrationConfiguration(), { enabled: true });
    tenor: GenericGifIntegrationConfiguration = Object.assign(new GenericGifIntegrationConfiguration(), { enabled: true, apiKey: "3Z0688EVWYKH" });
}

export class GenericGifIntegrationConfiguration {
    enabled: boolean = false;
    apiKey?: string;
    apiKeyPath?: string;
}
