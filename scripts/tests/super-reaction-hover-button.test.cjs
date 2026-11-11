const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("client/plugins/fosscordSuperReactions/index.ts", "utf8");
const replacements = [...source.matchAll(/match: (\/[^\n]+\/[gim]*),\s*replace:\s*('[^\n]*'|"[^\n]*"),/g)].map(([, match, replace]) => {
    const expression = vm.runInNewContext(match);
    return {
        match: new RegExp(expression.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), expression.flags),
        replace: vm.runInNewContext(replace).replaceAll("$self", "plugin"),
    };
});

const addReactionButton =
    'function nr(e){let{channel:t,message:n,togglePopout:l,renderEmojiPicker:i,shouldShow:s}=e,o=r.useRef(null);return(0,a.jsx)(ev.Y,{targetElementRef:o,renderPopout:e=>{let{closePopout:l}=e;return i(t,n,l,!1)},shouldShow:s,onRequestClose:l,children:()=>(0,a.jsx)(nl.qv,{ref:o,label:eO.intl.string(eO.t.lfIHs4),icon:na.n,onClick:l},"add-reaction")})}';
const pickerRenderer =
    'function nx(e,t,n){let l=arguments.length>3&&void 0!==arguments[3]&&arguments[3],i={openPopoutType:"message_reaction_emoji_picker",...l&&{openPopoutType:"message_super_reaction_emoji_picker"}};return(0,a.jsx)(t8.C,{channel:e,closePopout:n,analyticsOverride:i,messageId:t.id})}';
const hoverBar = (children) =>
    `function np(e){let{channel:t,message:n,canCopy:l,canReact:h,showEmojiPicker:I,setPopout:v,isFocused:N}=e,R=()=>v({emojiPicker:!I});return(0,a.jsxs)(a.Fragment,{children:[${children}]})}`;
const nativeChildren = "h?(0,a.jsxs)(a.Fragment,{children:[(0,a.jsx)(nr,{togglePopout:R,renderEmojiPicker:nx,shouldShow:I,isFocused:N,channel:t,message:n})]}):null";
const popoverApiChildren = "h?(0,a.jsx)(nr,{togglePopout:R,renderEmojiPicker:nx,shouldShow:I,isFocused:N,channel:t,message:n}):null";
const picker =
    "let ir=s.memo(function(e){let{pickerIntention:i,channel:r,analyticsOverride:M=ii,messageId:H}=e,e_=null;let eO=null,[eR,eL]=s.useState(!1),eD=s.useRef(null),eb=el.default.getCurrentUser(),eM=(0,ed.ki)(eb);return(0,a.jsx)(t1,{isBurstReaction:eR,onBurstReactionToggle:function(){eL(!eR)}})});";

const patch = (code) => replacements.reduce((current, { match, replace }) => current.replace(match, replace), code);

const render = (module, props) => {
    const elements = [];
    const jsx = (type, elementProps, key) => {
        const element = { type, props: elementProps, key };
        elements.push(element);
        return element;
    };
    const runtime = { jsx, jsxs: jsx, Fragment: "Fragment" };
    const plugin = { superReactionLabel: () => "Add Super Reaction", SuperReactionIcon: "SuperReactionIcon" };
    const scope = {
        a: runtime,
        r: { useRef: () => ({}) },
        ev: { Y: "Popout" },
        nl: { qv: "HoverButton" },
        eO: { intl: { string: () => "Add Reaction" }, t: {} },
        na: { n: "ReactionIcon" },
        t8: { C: "Picker" },
        plugin,
    };
    const factory = new Function(...Object.keys(scope), `${module};return {np,nr,nx};`);
    const { np, nr } = factory(...Object.values(scope));
    np(props);
    const buttons = [];
    for (const element of elements.filter((candidate) => candidate.type === nr)) {
        const rendered = nr(element.props);
        buttons.push({ props: element.props, button: rendered.props.children(), popout: rendered.props.renderPopout({ closePopout: "close" }) });
    }
    return buttons;
};

for (const [name, children] of [
    ["the native hover bar", nativeChildren],
    ["the hover bar after MessagePopoverAPI", popoverApiChildren],
]) {
    test(`adds a super reaction button next to Add Reaction in ${name}`, () => {
        const module = patch(`${addReactionButton}${pickerRenderer}${hoverBar(children)}`);
        const popouts = [];
        const props = {
            channel: { id: "1" },
            message: { id: "2" },
            canCopy: !0,
            canReact: !0,
            showEmojiPicker: !1,
            showEmojiBurstPicker: !0,
            setPopout: (value) => popouts.push(value),
            isFocused: !1,
        };
        const buttons = render(module, props);
        assert.equal(buttons.length, 2);
        const [normal, superReaction] = buttons;
        assert.equal(normal.button.props.label, "Add Reaction");
        assert.equal(normal.button.props.icon, "ReactionIcon");
        assert.equal(normal.popout.props.analyticsOverride.openPopoutType, "message_reaction_emoji_picker");
        assert.equal(superReaction.button.props.label, "Add Super Reaction");
        assert.equal(superReaction.button.props.icon, "SuperReactionIcon");
        assert.equal(superReaction.button.key, "add-super-reaction");
        assert.equal(superReaction.props.shouldShow, true);
        assert.equal(superReaction.popout.props.analyticsOverride.openPopoutType, "message_super_reaction_emoji_picker");
        superReaction.props.togglePopout();
        assert.deepEqual(popouts, [{ emojiBurstPicker: false }]);
    });
}

test("hides the super reaction button when the user can't react", () => {
    const module = patch(`${addReactionButton}${pickerRenderer}${hoverBar(nativeChildren)}`);
    const buttons = render(module, { channel: {}, message: {}, canReact: !1, setPopout: () => {} });
    assert.equal(buttons.length, 0);
});

const pickerState = (code, openPopoutType) => {
    let burst;
    const scope = {
        s: {
            memo: (component) => component,
            useState: (value) => {
                burst = value;
                return [value, (next) => (burst = next)];
            },
            useLayoutEffect: (effect) => effect(),
            useRef: () => ({}),
        },
        ii: {},
        el: { default: { getCurrentUser: () => ({}) } },
        ed: { ki: () => true },
        a: { jsx: () => null },
        t1: null,
        tweaks: { shouldSuperReactByDefault: false },
    };
    new Function(...Object.keys(scope), `${code}return ir;`)(...Object.values(scope))({ analyticsOverride: { openPopoutType } });
    return burst;
};

test("opens the emoji picker with Super Reactions on only for the super reaction button", () => {
    const patched = patch(picker);
    assert.notEqual(patched, picker);
    assert.equal(pickerState(patched, "message_super_reaction_emoji_picker"), true);
    assert.equal(pickerState(patched, "message_reaction_emoji_picker"), false);
    assert.equal(pickerState(patched, undefined), false);
});

test("the picker patch and SuperReactionTweaks both apply in either order", () => {
    const tweaks = (code) => code.replace(/(\[eR,eL\]=s\.useState\()!1\)/, "$1tweaks.shouldSuperReactByDefault&&i===1)");
    for (const patched of [patch(tweaks(picker)), tweaks(patch(picker))]) {
        assert.match(patched, /tweaks\.shouldSuperReactByDefault/);
        assert.match(patched, /useLayoutEffect/);
        assert.equal(pickerState(patched, "message_super_reaction_emoji_picker"), true);
        assert.equal(pickerState(patched, "message_reaction_emoji_picker"), false);
    }
});
