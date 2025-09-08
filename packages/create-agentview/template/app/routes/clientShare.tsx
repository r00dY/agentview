import type { Route } from "./+types/clientShare";
import { apiFetch } from "~/lib/apiFetch";


export async function clientAction({ request, params }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const is_shared = formData.get("is_shared") === "true" ;
  
  const response = await apiFetch(`/api/clients/${params.clientId}`, {
    method: "PUT",
    body: { is_shared },
  });

  if (!response.ok) {
    return { ok: false, error: response.error };
  }

  return { ok: true, data: {} };
}
