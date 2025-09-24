import { useFetcher, useLoaderData } from "react-router";
import type { RouteObject } from "react-router";

import { Header, HeaderTitle } from "~/components/header";
import { createOrUpdateSchema } from "~/lib/remoteConfig";

async function loader() {
  return { schema: await createOrUpdateSchema() };
}

function Component() {
  const { schema } = useLoaderData<typeof loader>();

  return <div>
    <Header>
      <HeaderTitle title="Schema" />
    </Header>

    <div className="p-6 max-w-6xl">
        { !schema && <div>No schema found</div> }
        { schema && (
          <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm">
            {JSON.stringify(schema, null, 2)}
          </pre>
        ) }
    </div>
  </div>
}

export const configsRoute: RouteObject = {
  Component,
  loader,
}