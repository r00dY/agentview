import type { ActionErrorResponse, ActionResponse } from "./errors";

export const commentFormDataToJSON = (formData: FormData): ActionResponse => {
    // Collect all score fields from form data
    const scores: Record<string, any> = {};
    const scoreErrors: Record<string, string> = {};
    
    // Get all form fields that are scores (they will be JSON strings)
    for (const [key, value] of formData.entries()) {
        if (key.startsWith("scores.")) {
            const scoreName = key.replace("scores.", "");

            if (value === "") {
                continue;
            }

            try {
                const parsedValue = JSON.parse(value as string);
                // Only add score if value is not undefined
                if (parsedValue !== undefined) {
                    scores[scoreName] = parsedValue;
                }
            } catch (error) {
                scoreErrors[key] = "Invalid JSON value";
            }
        }
    }

    let comment: string | undefined = undefined;

    const formComment = formData.get("comment");
    if (typeof formComment === "string") {
        if (formComment.trim() !== "") {
            comment = formComment;
        }
    }

    // Validation: at least one of content or scores must be provided
    if (!comment && Object.keys(scores).length === 0) {
        return { 
            ok: false, 
            error: {
                message: "At least one of comment or score must be provided",
            }
        };
    }

    // If there are JSON parsing errors, return them
    if (Object.keys(scoreErrors).length > 0) {
        return { 
            ok: false, 
            error: { 
                message: "Invalid form data",
                fieldErrors: scoreErrors
            } 
        };
    }

    return {
        ok: true,
        data: {
            comment,
            scores,
        }
    }
}