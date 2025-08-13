import type { Route } from "./+types/threadComments";
import { apiFetch } from "~/lib/apiFetch";
import { type ActionResponse } from "~/lib/errors";

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse> {
    const formData = await request.formData();
    const content = formData.get("content");
    const activityId = formData.get("activityId");
    const editCommentMessageId = formData.get("editCommentMessageId");
    const deleteCommentMessageId = formData.get("deleteCommentMessageId");

    try {
        // Creating a new comment
        if (content && activityId && !editCommentMessageId && !deleteCommentMessageId) {
            const response = await apiFetch('/api/comments', {
                method: 'POST',
                body: {
                    content: content as string,
                    activityId: activityId as string,
                }
            });

            if (!response.ok) {
                return { ok: false, error: response.error };
            }

            return { ok: true, data: response.data };
        }

        // Editing a comment
        if (content && editCommentMessageId && !deleteCommentMessageId) {
            const response = await apiFetch(`/api/comments/${editCommentMessageId}`, {
                method: 'PUT',
                body: {
                    content: content as string,
                }
            });

            if (!response.ok) {
                return { ok: false, error: response.error };
            }

            return { ok: true, data: response.data };
        }

        // Deleting a comment
        if (deleteCommentMessageId && !editCommentMessageId) {
            const response = await apiFetch(`/api/comments/${deleteCommentMessageId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                return { ok: false, error: response.error };
            }

            return { ok: true, data: response.data };
        }

        return { ok: false, error: { message: "Invalid request parameters" } };

    } catch (error) {
        console.error('Error handling comment:', error);
        return { ok: false, error: { message: "Failed to handle comment" } };
    }
}