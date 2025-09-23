import { data } from "react-router";
import { apiFetch } from "~/lib/apiFetch";


export async function action({ params }: { params: { invitationId: string } }) {
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

export default function MembersInviteCancel() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Cancel Invitation</h1>
      <p>Cancel invitation page content goes here.</p>
    </div>
  );
}

