import type { ActionErrorResponse, ActionResponse } from "./errors";
import { parseFormData } from "./parseFormData";

export const commentFormDataToJSON = (formData: FormData): ActionResponse => {
    const data = parseFormData(formData, { excludedFields: ["comment"] });
    let comment: string | undefined = undefined;

    const formComment = formData.get("comment");
    if (typeof formComment === "string") {
        if (formComment.trim() !== "") {
            comment = formComment;
        }
    }

    return {
        ok: true,
        data: {
            comment,
            scores: data.scores
        }
    }
}