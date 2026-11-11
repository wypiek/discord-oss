import { blueBright } from "picocolors";
import { KittyLogo } from "./KittyLogo";

export class Logo {
    public static async printLogo() {
        await KittyLogo.initialise();
        if (KittyLogo.isSupported) KittyLogo.printLogo();
        else console.log(this.AsciiLogo);
    }

    private static AsciiLogo = blueBright(
        `
  ████      ████     ███████╗██████╗  █████╗  ██████╗███████╗██████╗  █████╗ ██████╗ 
 ███████  ███████    ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗
 ████████████████    ███████╗██████╔╝███████║██║     █████╗  ██████╔╝███████║██████╔╝
█████   ██   █████   ╚════██║██╔═══╝ ██╔══██║██║     ██╔══╝  ██╔══██╗██╔══██║██╔══██╗
██████████████████   ███████║██║     ██║  ██║╚██████╗███████╗██████╔╝██║  ██║██║  ██║
 ████████████████    ╚══════╝╚═╝     ╚═╝  ╚═╝ ╚═════╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝`.substring(1),
    );
}
