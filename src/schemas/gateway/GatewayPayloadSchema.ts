// TODO: should this even be in schemas?
import { Tuple } from "lambert-server/check";

export const PayloadSchema = {
    op: Number,
    $d: new Tuple(Object, Number), // or number for heartbeat sequence
    $s: Number,
    $t: String,
};
