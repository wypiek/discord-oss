// Minor port of https://github.com/TheArcaneBrony/ArcaneLibs/blob/master/ArcaneLibs/ConsoleUtils.cs
import { RgbValue } from "./ColorUtils";

export class ConsoleUtils {
    public static ColorSequence(rgb: RgbValue) {
        return rgb.asAnsiEscapeSequence();
    }
    public static SetConsoleColor(rgb: RgbValue) {
        console.log(rgb.asAnsiEscapeSequence());
    }
    public static ColoredString(text: string, rgb: RgbValue) {
        return rgb.asAnsiEscapeSequence() + text + "\x1b[0m";
    }
}
