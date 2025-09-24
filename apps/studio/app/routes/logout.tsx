import { redirect, data, type RouteObject } from "react-router";
import { authClient } from "~/lib/auth-client";

async function loader() {
  const sessionResponse = await authClient.getSession()

  if (!sessionResponse.data) {
    return redirect("/");
  }

  const response = await authClient.signOut();

  if (response.error) {
    throw data(response.error.message ?? "Logout failed", { status: response.error.status })
  }

  return redirect('/');
}

export const logoutRoute : RouteObject = {
  loader
}