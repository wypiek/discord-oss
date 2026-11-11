export class E2eeLimits {
    trustServerByDefault: boolean = true;
    maxEnvelopeBytes: number = 64 * 1024;
    maxEnvelopeDevices: number = 256;
    pendingDeviceTtlHours: number = 7 * 24;
    deviceRegistrationsPerHour: number = 30;
    deviceUpdatesPerHour: number = 60;
    keyQueriesPerMinute: number = 60;
}
