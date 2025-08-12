import type { Route } from "./+types/login";
import { auth } from "~/.server/auth";
import { APIError } from "better-auth/api";

export async function action({
  request,
}: Route.ActionArgs) {

  await auth.api.signOut({
    headers: request.headers,
  });

  try {
    await auth.api.signOut({
        headers: request.headers,
      });

    return {
        success: true
    }
    
  } catch (error) {
    if (error instanceof APIError) {
      return { error: error.message };
    }
    return { error: 'An unexpected error occurred. Please try again.' };
  }
}
