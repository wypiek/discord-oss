import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { BaseClassWithoutId } from "./BaseClass";
import { DiscoveryCategory } from "@spacebar/schemas";

// was this an old response format? Keeping for completeness sake
// [{
// 	"id": 16,
// 	"default": "Anime & Manga",
// 	"localizations": {
// 			"de": "Anime & Manga",
// 			"fr": "Anim\u00e9s et mangas",
// 			"ru": "\u0410\u043d\u0438\u043c\u0435 \u0438 \u043c\u0430\u043d\u0433\u0430"
// 		}
// 	},
// 	"is_primary": false/true
// }]

@Entity({
    name: "categories",
})
export class Categories extends BaseClassWithoutId {
    // Not using snowflake

    @PrimaryGeneratedColumn({ type: "int2" })
    id: number;

    @Column({ nullable: true })
    name: string;

    @Column({ type: "jsonb" })
    localizations: CategoryLocalization;

    // Whether to show the category prominently (e.g. in a sidebar) instead of only secondary (e.g. in search results)
    @Column({ nullable: true })
    is_primary: boolean;

    // TODO: was this removed?
    @Column({ nullable: true })
    icon?: string;

    public toDiscoveryCategory(locale?: string): DiscoveryCategory {
        locale ??= "en-US";
        let name = this.name;
        if (locale in this.localizations) name = this.localizations[locale] ?? this.name;

        return {
            id: this.id,
            name: name,
            is_primary: this.is_primary,
        } satisfies DiscoveryCategory;
    }
}

export type CategoryLocalization = { [locale: string]: string };
