import { data } from "react-router";
import type { Route } from "./+types/membersInviteCancel";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";
import { apiFetch } from "~/lib/apiFetch";


export async function clientAction({ params }: Route.ClientActionArgs) {
  const response = await apiFetch(`/api/invitations/${params.invitationId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    return {
      ok: false,
      error: response.error,
    }
  }

  return {
    ok: true,
    data: null
  }
}

