import type { Route } from "./+types/threadActivityComments";
import { apiFetch } from "~/lib/apiFetch";
import { type ActionResponse } from "~/lib/errors";

// export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse> {
//     const formData = await request.formData();
//     const content = formData.get("content");
//     const activityId = formData.get("activityId");
//     const editCommentMessageId = formData.get("editCommentMessageId");
//     const deleteCommentMessageId = formData.get("deleteCommentMessageId");

//     try {
//         // Creating a new comment
//         if (content && activityId && !editCommentMessageId && !deleteCommentMessageId) {
//             const response = await apiFetch('/api/comments', {
//                 method: 'POST',
//                 body: {
//                     content: content as string,
//                     activityId: activityId as string,
//                 }
//             });

//             if (!response.ok) {
//                 return { ok: false, error: response.error };
//             }

//             return { ok: true, data: response.data };
//         }

//         // Editing a comment
//         if (content && editCommentMessageId && !deleteCommentMessageId) {
//             const response = await apiFetch(`/api/comments/${editCommentMessageId}`, {
//                 method: 'PUT',
//                 body: {
//                     content: content as string,
//                 }
//             });

//             if (!response.ok) {
//                 return { ok: false, error: response.error };
//             }

//             return { ok: true, data: response.data };
//         }

//         // Deleting a comment
//         if (deleteCommentMessageId && !editCommentMessageId) {
//             const response = await apiFetch(`/api/comments/${deleteCommentMessageId}`, {
//                 method: 'DELETE',
//             });

//             if (!response.ok) {
//                 return { ok: false, error: response.error };
//             }

//             return { ok: true, data: response.data };
//         }

//         return { ok: false, error: { message: "Invalid request parameters" } };

//     } catch (error) {
//         console.error('Error handling comment:', error);
//         return { ok: false, error: { message: "Failed to handle comment" } };
//     }
// }


// import type { Route } from "./+types/threadScoresAndComments";
// import { apiFetch } from "~/lib/apiFetch";
// import { type ActionResponse } from "~/lib/errors";

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse> {
    const formData = await request.formData();
    
    // Collect all score fields from form data
    const scores: Record<string, any> = {};
    const errors: Record<string, string> = {};
    
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
                errors[key] = "Invalid JSON value";
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
    if (Object.keys(errors).length > 0) {
        return { 
            ok: false, 
            error: { 
                message: "Invalid form data",
                fieldErrors: errors
            } 
        };
    }

    const response = await apiFetch(`/api/threads/${params.id}/activities/${params.activityId}/comments`, {
        method: 'POST',
        body: {
            comment,
            scores
        }
    });

    if (!response.ok) {
        return { ok: false, error: response.error };
    }

    return { ok: true, data: { } }
}