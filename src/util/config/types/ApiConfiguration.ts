import { EndpointConfiguration } from "./EndpointConfiguration";

export class ApiConfiguration extends EndpointConfiguration {
    defaultVersion: string = "9";
    activeVersions: string[] = ["6", "7", "8", "9"];
}
