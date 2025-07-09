import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";
import { Button } from "~/components/ui/button";
import { auth } from "../../lib/auth";
import { redirect } from "react-router";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export async function loader({request}: Route.LoaderArgs) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    console.log("[home] not logged in, redirecting to login")
    return redirect('/login');
  }

  console.log("[home] logged in")
  return null;
}

export default function Home() {
  return <div className="flex flex-col items-center justify-center h-screen">
    <h1>Hello World</h1>
    <div>
      <Button>Click me</Button>
    </div>
  </div>
}
