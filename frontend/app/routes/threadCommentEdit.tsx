import type { Route } from "./+types/threadCommentEdit";
import { apiFetch } from "~/lib/apiFetch";
import { type ActionResponse } from "~/lib/errors";

export async function clientAction({ request, params }: Route.ClientActionArgs): Promise<ActionResponse> {
    const formData = await request.formData();
    const content = formData.get("content");
    const editCommentMessageId = formData.get("editCommentMessageId");

    if (!content || !editCommentMessageId) {
        return { ok: false, error: { message: "Content and comment ID are required" } };
    }

    try {
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

    } catch (error) {
        console.error('Error editing comment:', error);
        return { ok: false, error: { message: "Failed to edit comment" } };
    }
} 