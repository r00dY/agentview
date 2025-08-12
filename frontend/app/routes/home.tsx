import type { Route } from "./+types/home";
import { Button } from "~/components/ui/button";


export default function Home() {
  return <div className="flex flex-col items-center justify-center h-screen">
    <h1>Hello World</h1>
    <div>
      <Button>Click me</Button>
    </div>
  </div>
}
