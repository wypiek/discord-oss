import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { GuildMemberStore, React, useStateFromStores } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

const ApplicationWidgetConfigStore = findStoreLazy("ApplicationWidgetConfigStore") as {
    getConfig(applicationId: string): { owned?: boolean } | undefined;
};

type AppWidget = { applicationId: string };
type WidgetSplit = { applicationWidgets: AppWidget[]; collectionWidgets: unknown[] };
const OWN_WIDGETS_TAB = "yourWidgets";
const OWN_WIDGETS_LABEL = "Your Profile Widgets";

export default definePlugin({
    name: "FosscordApps",
    description: "Keeps app components, the app launcher and the activity shelf in step with the instance.",
    authors: [FosscordAuthor],
    required: true,

    // Widgets made in the developer portal get their own tab in the Add Widget picker instead of sitting under Game Stats.
    splitOwnWidgets(split: WidgetSplit) {
        const isOwn = (widget: AppWidget) => ApplicationWidgetConfigStore.getConfig(widget.applicationId)?.owned === true;
        return {
            ...split,
            applicationWidgets: split.applicationWidgets.filter((w) => !isOwn(w)),
            fcOwnWidgets: split.applicationWidgets.filter(isOwn),
        };
    },

    ownWidgetsTab(Item: React.ComponentType<Record<string, unknown>>, className: string) {
        return React.createElement(Item, { key: OWN_WIDGETS_TAB, className, id: OWN_WIDGETS_TAB, "aria-label": OWN_WIDGETS_LABEL }, OWN_WIDGETS_LABEL);
    },

    ownWidgetsPanel({
        List,
        Empty,
        className,
        widgets,
        ...props
    }: {
        List: React.ComponentType<any>;
        Empty: React.ComponentType<any>;
        className: string;
        widgets: AppWidget[];
    } & Record<string, unknown>) {
        if (!widgets.length)
            return React.createElement(
                Empty,
                null,
                "You haven't made a profile widget yet. ",
                React.createElement("a", { href: "/developers/applications", target: "_blank", rel: "noreferrer" }, "Make one in the Developer Portal"),
                ".",
            );
        return React.createElement(
            "div",
            { className },
            React.createElement(List, {
                applicationWidgets: widgets,
                dense: widgets.length >= 20,
                ...props,
            }),
        );
    },

    useMemberVersion() {
        return useStateFromStores([GuildMemberStore], () => (GuildMemberStore as unknown as { getMemberVersion(): number }).getMemberVersion());
    },

    patches: [
        {
            find: "checkRecentlyTalkedOnEmptyQuery:!1,limit:15",
            replacement: {
                match: /(?=return\(0,\i\.jsx\)\(\i,\{selectActionComponent:\i,queryOptions:function\(\i\)\{return function\(\i,\i,\i\)\{let \i=\i\.\i\.getChannel)/,
                replace: "$self.useMemberVersion();",
            },
        },
        // The Add Widget cards for app widgets say "Link your account to show off your game stats" until the app is linked over
        // OAuth. Widgets made in the developer portal have no account to link, so the line stays hidden unless linking is possible.
        {
            find: 'PLACEHOLDER_CONNECT",applicationId',
            replacement: [
                {
                    match: /(\{hasAlreadyLinked:(\i),canStartAuthorization:(\i),startAuthorization:\i,fetched:(\i)\}=.{0,350}?return"default"!==\i\|\|null==\i)/,
                    replace: "$1||($4&&!$2&&!$3)",
                },
                {
                    match: /(\{hasAlreadyLinked:(\i),fetched:(\i)\}=\(0,\i\.\i\)\(\i\);return null==\i)/,
                    replace: "$1||($3&&!$2)",
                },
            ],
        },
        {
            find: 'case"createYourOwn":return',
            replacement: [
                {
                    match: /(\{applicationWidgets:\i,collectionWidgets:\i)\}=(\i\.useMemo\(\(\)=>\(function\(\i\)\{.{0,200}?\}\)\(\i\),\[\i\]\))/,
                    replace: "$1,fcOwnWidgets}=$self.splitOwnWidgets($2)",
                },
                {
                    match: /return (\i)=(\i\|\|\i\?"gameStats"===(\i)\?\i\?\(0,\i\.jsx\)\("div",\{className:(\i\.\i),children:\(0,\i\.jsx\)\((\i),\{applicationWidgets:\i,dense:\i\.length>=20,handleAddWidget:(\i),isSubmitting:(\i),trackUserProfileEditAction:(\i),highlightedApplicationIds:\i\}\)\}\):\(0,\i\.jsx\)\((\i),)/,
                    replace:
                        'return $1="yourWidgets"===$3?$self.ownWidgetsPanel({List:$5,Empty:$9,className:$4,widgets:fcOwnWidgets,handleAddWidget:$6,isSubmitting:$7,trackUserProfileEditAction:$8}):$2',
                },
                {
                    // The tab name lookup throws on a category it doesn't know.
                    match: /case"createYourOwn":return/,
                    replace: 'case"yourWidgets":return null;$&',
                },
                {
                    match: /(\.Panel,\{id:\i,"aria-label":)(\i\.intl\.string\((\i)\))/,
                    replace: '$1null==$3?"Your Profile Widgets":$2',
                },
                {
                    match: /(\(0,\i\.jsxs\)\((\i\.\i\.Item),\{className:(\i\.\i),id:"gameStats",.{0,200}?\]\}\))/,
                    replace: "$1,$self.ownWidgetsTab($2,$3)",
                },
            ],
        },
        {
            find: "#{intl::RL7Ncg::raw}",
            replacement: {
                match: /(\.TEXT\?\i\.intl\.string\(\i\.t#{intl::iKZctW::raw}\):\i\.intl\.string\(\i\.t)#{intl::RL7Ncg::raw}/,
                replace: "$1.MlQm3T",
            },
        },
    ],
});
