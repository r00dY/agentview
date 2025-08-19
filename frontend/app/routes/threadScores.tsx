import type { Route } from "./+types/threadScores";
import { apiFetch } from "~/lib/apiFetch";
import { type ActionResponse } from "~/lib/errors";

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse> {
    const formData = await request.formData();
    const name = formData.get("name");
    const value = formData.get("value");
    const comment = formData.get("comment");

    // Parse the JSON value
    let parsedValue;
    try {
        parsedValue = JSON.parse(value as string);
    } catch (error) {
        return { ok: false, error: { message: "Invalid JSON value" } };
    }

    let commentId : string | null = null

    if (comment) {
        const commentResponse = await apiFetch('/api/comments', {
            method: 'POST',
            body: {
                content: comment as string,
                activityId: params.activityId,
            }
        });

        if (!commentResponse.ok) {
            return { ok: false, error: commentResponse.error };
        }

        commentId = commentResponse.data.id;
    }

    // Create the score
    const response = await apiFetch('/api/scores', {
        method: 'POST',
        body: {
            activityId: params.activityId,
            name: name as string,
            value: parsedValue,
            commentId
        }
    });

    if (!response.ok) {
        return { ok: false, error: response.error };
    }

    return { ok: true, data: response.data };

}
