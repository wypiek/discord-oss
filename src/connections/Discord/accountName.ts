export const discordAccountName = ({ username, discriminator }: { username: string; discriminator?: string | null }) =>
    discriminator && discriminator !== "0" ? `${username}#${discriminator}` : username;
