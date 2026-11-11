import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

export default definePlugin({
    name: "FosscordFullServerTags",
    description: "Shows server tags in full, growing the tag box to fit, instead of cutting them off after a few characters. Instance staff can set tags longer than 4 characters.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
});
