import type { Route } from "./+types/threadActivityComments";
import { apiFetch } from "~/lib/apiFetch";
import { type ActionResponse } from "~/lib/errors";
import { commentFormDataToJSON } from "~/lib/commentForm";

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse> {
    const formData = await request.formData();
    const extractionResponse = commentFormDataToJSON(formData);

    // error
    if (!extractionResponse.ok) {
        return extractionResponse;
    }

    const { comment, scores } = extractionResponse.data;

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