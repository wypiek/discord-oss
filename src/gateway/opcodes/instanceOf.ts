import { instanceOf } from "lambert-server/check";
import { WebSocket } from "@spacebar/gateway";
import { CLOSECODES } from "../util/Constants";

export function check(this: WebSocket, schema: unknown, data: unknown) {
    try {
        const error = instanceOf(schema, data, { path: "body" });
        if (error !== true) {
            throw error;
        }
        return true;
    } catch (error) {
        console.error(error);
        // invalid payload
        this.close(CLOSECODES.Decode_error);
        throw error;
    }
}
