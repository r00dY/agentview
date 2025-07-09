import type { Route } from "./+types/home";
import { Button } from "~/components/ui/button";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}


export default function Home() {
  return <div className="flex flex-col items-center justify-center h-screen">
    <h1>Hello World</h1>
    <div>
      <Button>Click me</Button>
    </div>
  </div>
}
