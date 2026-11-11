import { PartialEmoji } from "@spacebar/schemas";
import { PollAnswerIdList } from "./IdLists";

export interface Poll {
    question: PollMedia;
    answers: PollAnswer[];
    expiry: Date;
    allow_multiselect: boolean;
    layout_type?: number;
    results?: PollResult;
}

export interface PollMedia {
    text?: string;
    emoji?: PartialEmoji;
}

export interface PollAnswer {
    answer_id?: number;
    poll_media: PollMedia;
}

export interface PollQuestionMedia {
    /**
     * @maxLength 300
     */
    text?: string;
    emoji?: PartialEmoji;
}

export interface PollAnswerMedia {
    /**
     * @maxLength 55
     */
    text?: string;
    emoji?: PartialEmoji;
}

export interface PollAnswerCreation {
    answer_id?: number;
    poll_media: PollAnswerMedia;
}

export interface PollResult {
    is_finalized: boolean;
    answer_counts: PollAnswerCount[];
}

export interface PollAnswerCount {
    id: string;
    count: number;
    me_voted: boolean;
}

export interface PollUserAnswersSchema {
    answer_ids: PollAnswerIdList;
}
