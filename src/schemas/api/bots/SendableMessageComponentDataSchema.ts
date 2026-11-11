import { Snowflake } from "../../Identifiers";
import { MessageComponentType } from "../messages";
import { ApplicationCommandType } from "./ApplicationCommandSchema";

export interface SendableMessageComponentDataSchema {
    id?: number;
    component_type?: MessageComponentType;
    type?: ApplicationCommandType;
    custom_id: string;
    values?: Snowflake[] | string[];
}
