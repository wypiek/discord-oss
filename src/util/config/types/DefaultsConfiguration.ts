import { GuildDefaults, UserDefaults } from "./subconfigurations/defaults";

export class DefaultsConfiguration {
    guild: GuildDefaults = new GuildDefaults();
    user: UserDefaults = new UserDefaults();
}
