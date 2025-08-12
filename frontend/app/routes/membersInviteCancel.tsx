import { data } from "react-router";
import type { Route } from "./+types/membersInviteCancel";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";


export async function clientAction({ params }: Route.ClientActionArgs) {
  const response = await fetch(`${getAPIBaseUrl()}/api/invitations/${params.invitationId}`, {
    method: "DELETE",
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw data('Failed to fetch invitations', {
      status: response.status, // TODO: standardised error handling from clientLoaders!!! 
    });
  }

  return {
    status: "success",
    data: null
  }
}

