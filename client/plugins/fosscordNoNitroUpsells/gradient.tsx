import { Checkbox, React, Text } from "@webpack/common";

type ThemeColors = [number | null, number | null] | null;

type GradientProps = {
    pendingColors?: ThemeColors;
    onThemeColorsChange: (colors: ThemeColors) => void;
    user: { id: string };
    guildId?: string;
};

export const hasGradientColors = (colors: ThemeColors | undefined) => Array.isArray(colors) && colors.some((color) => color != null);

function GradientToggle({ props, current, fallback }: { props: GradientProps; current?: ThemeColors; fallback: [number, number] }) {
    const colors = props.pendingColors === undefined ? current : props.pendingColors;
    const enabled = hasGradientColors(colors);
    const remembered = React.useRef<ThemeColors>(hasGradientColors(colors) ? colors! : fallback);
    if (hasGradientColors(colors)) remembered.current = colors!;
    return (
        <div className="fosscord-gradient-toggle" style={{ flexBasis: "100%", gridColumn: "1 / -1", width: "100%" }}>
            <Checkbox value={enabled} onChange={(_, checked) => props.onThemeColorsChange(checked ? remembered.current : null)}>
                <Text variant="text-sm/medium">Show profile gradient</Text>
            </Checkbox>
            <Text variant="text-sm/normal" color="text-muted" style={{ marginTop: 8 }}>
                Choose your profile colors. Turn this off to use a plain profile. Save changes to update your profile.
            </Text>
        </div>
    );
}

export const renderGradientToggle = (props: GradientProps, current: ThemeColors, fallback: [number, number]) =>
    props.guildId ? null : <GradientToggle key={props.user.id} props={props} current={current} fallback={fallback} />;
