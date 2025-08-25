import type { Route } from "./+types/threadActivityComment";
import { apiFetch } from "~/lib/apiFetch";
import { type ActionResponse } from "~/lib/errors";

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse> {
    const response = await apiFetch(`/api/threads/${params.id}/activities/${params.activityId}/comments/${params.commentId}`, {
        method: 'DELETE'
    });

    if (!response.ok) {
        return { ok: false, error: response.error };
    }

    return { ok: true, data: { } }
}