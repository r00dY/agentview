import { apiFetch } from "~/lib/apiFetch";
import { type ActionResponse } from "~/lib/errors";
import { commentFormDataToJSON } from "~/lib/commentForm";

export async function action({ request, params }: { request: Request; params: { id: string; itemId: string } }): Promise<ActionResponse> {
    const formData = await request.formData();
    const extractionResponse = commentFormDataToJSON(formData);

    // error
    if (!extractionResponse.ok) {
        return extractionResponse;
    }

    const { comment, scores } = extractionResponse.data;

    // Validation: at least one of content or scores must be provided
    if (!comment && Object.keys(scores).length === 0) {
        return { 
            ok: false, 
            error: {
                message: "At least one of comment or score must be provided",
            }
        };
    }

    const response = await apiFetch(`/api/sessions/${params.id}/items/${params.itemId}/comments`, {
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

export default function SessionItemComments() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Session Item Comments</h1>
      <p>Session item comments page content goes here.</p>
    </div>
  );
}