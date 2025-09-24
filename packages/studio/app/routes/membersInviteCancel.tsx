import { apiFetch } from "~/lib/apiFetch";
import type { ActionFunctionArgs, RouteObject } from "react-router";

async function action({ params }: ActionFunctionArgs) {
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

export const membersInviteCancelRoute: RouteObject = {
  action,
}