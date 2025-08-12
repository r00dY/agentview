import type { Route } from "./+types/login";
import { APIError } from "better-auth/api";
import { authClient } from "~/lib/auth-client";

export async function clientAction({
  request,
}: Route.ActionArgs) {

  try {
    const { data, error } = await authClient.signOut();

    if (error) {
      return { status: "error", error };
    }

    return {
        status: "success",
        data: null
    }
    
  } catch (error) {
    if (error instanceof APIError) {
      return { status: "error", error: { message: error.message } };
    }
    return { status: "error", error: { message: 'An unexpected error occurred. Please try again.' } };
  }
}
