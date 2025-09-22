import type { Route } from "./+types/sessionActivityComment";
import { apiFetch } from "~/lib/apiFetch";
import { commentFormDataToJSON } from "~/lib/commentForm";
import { type ActionResponse } from "~/lib/errors";

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse> {
    if (request.method === 'DELETE') {
        
        const response = await apiFetch(`/api/sessions/${params.id}/items/${params.activityId}/comments/${params.commentId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            return { ok: false, error: response.error };
        }

        return { ok: true, data: {} }

    }
    else if (request.method === 'PUT') {
        const formData = await request.formData();
        const extractionResponse = commentFormDataToJSON(formData);

        if (!extractionResponse.ok) {
            return extractionResponse;
        }

        const { comment, scores } = extractionResponse.data;

        const response = await apiFetch(`/api/sessions/${params.id}/items/${params.activityId}/comments/${params.commentId}`, {
            method: 'PUT',
            body: {
                comment,
                scores
            }
        });

        if (!response.ok) {
            return { ok: false, error: response.error };
        }

        return { ok: true, data: {} }
    }

    throw new Error('Method not allowed');
}