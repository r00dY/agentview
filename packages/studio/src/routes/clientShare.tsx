import { apiFetch } from "~/lib/apiFetch";
import type { ActionFunctionArgs, RouteObject } from "react-router";

async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const isShared = formData.get("isShared") === "true" ;
  
  const response = await apiFetch(`/api/clients/${params.clientId}`, {
    method: "PUT",
    body: { isShared },
  });

  if (!response.ok) {
    return { ok: false, error: response.error };
  }

  return { ok: true, data: {} };
}

function Component() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Client Share</h1>
      <p>Client share page content goes here.</p>
    </div>
  );
}

export const clientShareRoute: RouteObject = {
  Component,
  action,
}
