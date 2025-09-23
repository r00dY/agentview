import { APIError } from "better-auth/api";
import { redirect, data } from "react-router";
import { authClient } from "~/lib/auth-client";

async function loader({ request }: { request: Request }) {
  const response = await authClient.signOut();

  if (response.error) {
    throw data(response.error.message ?? "Logout failed", { status: response.error.status })
  }

  return redirect('/');
}

export const logout = {
  loader
}

// export async function action({
//   request,
// }: { request: Request }) {

//   const { data, error } = await authClient.signOut();

//   if (error) {
//     return { ok: false, error };
//   }

//   return { ok: true, data };
// }

// export default function Logout() {
//   return (
//     <div className="p-6">
//       <h1 className="text-2xl font-bold mb-4">Logging out...</h1>
//       <p>Please wait while we log you out.</p>
//     </div>
//   );
// }
