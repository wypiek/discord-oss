import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

export default definePlugin({
    name: "FosscordModals",
    description: "Keeps active dialogs and their popouts above the backdrop, and lets outside clicks close nested dialogs.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
});
