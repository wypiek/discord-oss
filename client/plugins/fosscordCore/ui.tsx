import type { ReactNode } from "react";
import { Button as NativeButton, Forms, Text, TextInput } from "@webpack/common";

export function SettingsSection({ title, description, className, children }: { title: string; description?: string; className?: string; children: ReactNode }) {
    return (
        <section className={className} aria-label={title}>
            <div className="fosscord-ui-section-heading">
                <Forms.FormTitle tag="h3">{title}</Forms.FormTitle>
                {description && (
                    <Text variant="text-sm/normal" color="text-muted">
                        {description}
                    </Text>
                )}
            </div>
            {children}
        </section>
    );
}

export function Field({
    id,
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    className,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: "text" | "search";
    className?: string;
}) {
    return (
        <div className={className}>
            <label htmlFor={id}>
                <Text variant="text-sm/medium">{label}</Text>
            </label>
            <TextInput id={id} type={type} value={value} onChange={onChange} placeholder={placeholder} />
        </div>
    );
}

export function Button({ variant = "primary", disabled, onClick, children }: { variant?: "primary" | "secondary"; disabled?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <NativeButton
            type="button"
            color={variant === "secondary" ? NativeButton.Colors.PRIMARY : NativeButton.Colors.BRAND}
            size={NativeButton.Sizes.SMALL}
            disabled={disabled}
            onClick={onClick}
        >
            {children}
        </NativeButton>
    );
}
