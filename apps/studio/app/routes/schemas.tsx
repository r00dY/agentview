import { data, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/schemas";

import { Header, HeaderTitle } from "~/components/header";
import { apiFetch } from "~/lib/apiFetch";
import { Button } from "~/components/ui/button";
import { config } from "~/agentview.config";
import { serializeBaseConfig, getBaseConfig } from "~/lib/baseConfigHelpers";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = await apiFetch(`/api/dev/schemas/current`);
  
  if (!response.ok) {
    throw response.error;
  }

  return { schema: response.data };
}

export async function clientAction({ request }: Route.ActionArgs) {
  const response = await apiFetch(`/api/dev/schemas`, {
    method: "POST",
    body: {
        schema: serializeBaseConfig(getBaseConfig(config))
    }
  });
  
  if (!response.ok) {
    return {
        ok: false,
        error: response.error
    }
  }

  return {
    ok: true,
    data: response.data
  }
}

export default function SchemasPage() {
  const { schema } = useLoaderData<typeof clientLoader>();
  const fetcher = useFetcher();

  return <div>
    <Header>
      <HeaderTitle title="Schemas" />
    </Header>

    <div className="p-6 max-w-6xl">
        <fetcher.Form method="post" className="mb-4">
          <Button type="submit" disabled={fetcher.state === "submitting"}>
            { fetcher.state === "submitting" ? "Syncing..." : "Sync Schema" }
          </Button>
        </fetcher.Form>
        { !schema && <div>No schema found</div> }
        { schema && <div>{JSON.stringify(schema)}</div> }
    </div>
  </div>
} 