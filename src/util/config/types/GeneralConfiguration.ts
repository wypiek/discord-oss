import { Snowflake } from "@spacebar/util";
import { DEFAULT_INSTANCE_NAME } from "./ClientConfiguration";

export class GeneralConfiguration {
    instanceName: string = DEFAULT_INSTANCE_NAME;
    serverName: string | null = null;
    instanceDescription: string | null = null;
    frontPage: string | null = null;
    tosPage: string | null = null;
    privacyPage: string | null = null;
    guidelinesPage: string | null = null;
    correspondenceEmail: string | null = null;
    correspondenceUserID: string | null = null;
    image: string | null = null;
    instanceId: string = Snowflake.generate();
}
