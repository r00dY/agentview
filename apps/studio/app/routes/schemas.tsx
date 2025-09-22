import { data, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/schemas";

import { Header, HeaderTitle } from "~/components/header";
import { createOrUpdateSchema } from "~/lib/remoteConfig";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  return { schema: await createOrUpdateSchema() };
}

export default function SchemasPage() {
  const { schema } = useLoaderData<typeof clientLoader>();
  const fetcher = useFetcher();

  return <div>
    <Header>
      <HeaderTitle title="Schema" />
    </Header>

    <div className="p-6 max-w-6xl">
        {/* <fetcher.Form method="post" className="mb-4">
          <Button type="submit" disabled={fetcher.state === "submitting"}>
            { fetcher.state === "submitting" ? "Syncing..." : "Sync Schema" }
          </Button>
        </fetcher.Form> */}
        { !schema && <div>No schema found</div> }
        { schema && (
          <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm">
            {JSON.stringify(schema, null, 2)}
          </pre>
        ) }
    </div>
  </div>
} 