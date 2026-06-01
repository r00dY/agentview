import { z } from "zod";
import { ToggleGroupControl } from "./components/ToggleGroup";
import { OptionDisplay } from "./components/OptionDisplay";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { ScoreConfig } from "./types";
import type { Option } from "./components/Option";
import { PillSelect } from "./components/PillSelect";
import { PillMultiSelect } from "./components/PillMultiSelect";
import { OptionsDisplay } from "./components/OptionDisplay";

// Like
export type LikeScoreProps = {
    name?: string;
    title?: string;
    likeLabel?: string;
    dislikeLabel?: string;
    showLabels?: "always" | "on-select" | "never";
}

export function like(options?: LikeScoreProps): ScoreConfig {
    const { name, title, likeLabel, dislikeLabel, showLabels } = options ?? {};

    const likeOptions = [{ value: true, icon: ThumbsUp, label: likeLabel ?? "Like" }, { value: false, icon: ThumbsDown, label: dislikeLabel ?? "Don't Like" }]

    return {
        name: name ?? "like",
        schema: z.boolean(),
        title: title ?? "Like / Dislike",
        inputComponent: (props) => <ToggleGroupControl {...props} options={likeOptions} hideOptionsOnSelect showLabels={showLabels ?? "on-select"} optimistic />,
        displayComponent: (props) => <OptionDisplay {...props} options={likeOptions} />,
        runFooterComponent: (props) => <ToggleGroupControl {...props} options={likeOptions} hideOptionsOnSelect showLabels={showLabels ?? "on-select"} optimistic />
    }
}


// Select
export type SelectScoreProps = {
    name: string,
    title?: string;
    options: Array<Option<string> | string>;
}

export function select(args: SelectScoreProps): ScoreConfig {
    const { name, title, options } = args;
    const selectOptions = options.map((option) => typeof option === "string" ? { value: option } : option);

    return {
        name,
        schema: z.string(),
        title: title ?? name,
        inputComponent: (props) => <PillSelect {...props} options={selectOptions} />,
        displayComponent: (props) => <OptionDisplay {...props} options={selectOptions} />,
    }
}

// Multi-Select
export type MultiSelectScoreProps = {
    name: string,
    title?: string;
    options: Array<Option<string> | string>;
}

export function multiSelect(args: MultiSelectScoreProps): ScoreConfig {
    const { name, title, options } = args;
    const multiSelectOptions = options.map((option) => typeof option === "string" ? { value: option } : option);

    return {
        name,
        schema: z.array(z.string()),
        title: title ?? name,
        inputComponent: (props) => <PillMultiSelect {...props} options={multiSelectOptions} />,
        displayComponent: (props) => <OptionsDisplay {...props} options={multiSelectOptions} />,
    }
}