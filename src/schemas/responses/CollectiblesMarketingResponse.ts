export class CollectiblesMarketingResponse {
    marketings: {
        [key: string]: CollectiblesMarketingItem;
    };
}

export class CollectiblesMarketingItem {
    type: number;
    version: number;
    title: string;
    body: string;
}

export class AvatarDecorationMarketingItem extends CollectiblesMarketingItem {
    declare type: 0;
    // CDN URL to the avatar decoration
    avatar: string;
    // Asset IDs
    decorations: string[];
    dismissible_content: number; // Is this a generic property?
    ref_target_background: RefTargetBackground;
}

export class NameplateMarketingItem extends CollectiblesMarketingItem {
    declare type: 2;
    asset: string;
    popout_asset: string;
}

export class TargetBackgroundReference {
    light: string | null;
    dark: string | null;
}
export class TargetBackgroundReferenceInteraction {
    resting: TargetBackgroundReference;
    hovered: TargetBackgroundReference;
}

export class RefTargetBackground {
    style: TargetBackgroundReferenceInteraction;
    asset: TargetBackgroundReferenceInteraction;
}
