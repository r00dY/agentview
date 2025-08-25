import { Form, useFetcher } from "react-router";
import type { Route } from "./+types/home";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  const data = await request.json()

  return { ok: false, data }
}

export default function Home() {
  const fetcher = useFetcher()

  console.log('data', fetcher.data)

  return <div className="flex flex-col items-center justify-center h-screen">
    <h1>Hello World</h1>
    <div>
      <fetcher.Form method="post" encType="text/plain" onSubmit={(e) => {
        fetcher.submit({
          test: "lalala"
        }, {
          method: "post",
          encType: "application/json"
        })
        e.preventDefault()
      }}>
        <Input type="text" name="test" defaultValue="lalala" />
        <Button type="submit">Submit</Button>
      </fetcher.Form>

      {/* <fetcher.Form method="post" encType="application/json">
        <Input type="text" name="test" defaultValue="lalala" />
        <Button type="submit">Submit</Button>
      </fetcher.Form> */}
    </div>
  </div>
}
