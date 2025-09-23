import { apiFetch } from "~/lib/apiFetch";


export async function action({ request, params }: { request: Request; params: { clientId: string } }) {
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

export default function ClientShare() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Client Share</h1>
      <p>Client share page content goes here.</p>
    </div>
  );
}
