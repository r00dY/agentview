import { apiFetch } from "~/lib/apiFetch";
import { commentFormDataToJSON } from "~/lib/commentForm";
import { type ActionResponse } from "~/lib/errors";

export async function action({ request, params }: { request: Request; params: { id: string; itemId: string; commentId: string } }): Promise<ActionResponse> {
    if (request.method === 'DELETE') {
        
        const response = await apiFetch(`/api/sessions/${params.id}/items/${params.itemId}/comments/${params.commentId}`, {
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

        const response = await apiFetch(`/api/sessions/${params.id}/items/${params.itemId}/comments/${params.commentId}`, {
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

export default function SessionItemComment() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Session Item Comment</h1>
      <p>Session item comment page content goes here.</p>
    </div>
  );
}