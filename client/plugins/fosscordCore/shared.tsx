import type { PatchReplacement } from "@utils/types";
import { filters, mapMangledModuleLazy } from "@webpack";
import { useEffect } from "@webpack/common";

export const FosscordAuthor = { name: "Fosscord", id: 0n };

export const HOME_ROUTE = "/channels/@me";

const Router = mapMangledModuleLazy("transitionTo - Transitioning to", {
    replaceWith: filters.byCode("Replacing route with"),
});

function Redirect({ to }: { to: string }) {
    useEffect(() => Router.replaceWith(to), [to]);
    return null;
}

export const redirectTo = (to: string) => <Redirect to={to} />;

export const redirectHome = () => redirectTo(HOME_ROUTE);

export const hideSetting = (key: string, { replacesPredicate = false } = {}): PatchReplacement =>
    replacesPredicate
        ? {
              match: new RegExp(String.raw`(\.${key},\{.{0,400}?)usePredicate:`),
              replace: "$1usePredicate:()=>!1,_usePredicate:",
          }
        : { match: new RegExp(String.raw`\.${key},\{`), replace: "$&usePredicate:()=>!1," };

export const hideNotices = (types: string[]) => ({
    find: /\.DOWNLOAD_NAG\]:\{predicate:/,
    replacement: {
        match: new RegExp(String.raw`(\[\i\.\i\.(?:${types.join("|")})\]:\{)predicate:`, "g"),
        replace: "$1predicate:()=>!1,_predicate:",
    },
});
