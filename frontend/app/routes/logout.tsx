import type { Route } from "./+types/login";
import { APIError } from "better-auth/api";
import { authClient } from "~/lib/auth-client";

export async function clientAction({
  request,
}: Route.ActionArgs) {

  const { data, error } = await authClient.signOut();

  if (error) {
    return { ok: false, error };
  }

  return {
      ok: true,
      data: null
  }
}
