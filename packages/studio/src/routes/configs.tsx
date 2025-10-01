import { TerminalIcon } from "lucide-react";
import { useFetcher, useLoaderData } from "react-router";
import type { RouteObject } from "react-router";

import { Header, HeaderTitle } from "~/components/header";
import { Button } from "~/components/ui/button";
import { createOrUpdateConfig } from "~/lib/remoteConfig";

async function loader() {
  return { config: await createOrUpdateConfig() };
}

function Component() {
  const { config } = useLoaderData<typeof loader>();

  return <div>
    <Header>
      <HeaderTitle title="Config" />
    </Header>

    <div className="p-6 max-w-6xl">
        { !config.config && <div>No schema found</div> }
        { config.config && (<div>
          <Button variant="outline" onClick={() => {
            console.log(config.config);
          }}><TerminalIcon /> Print config to console</Button>
          <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm mt-4">
            {JSON.stringify(config.config, null, 2)}
          </pre>
        </div> ) }
    </div>
  </div>
}

export const configsRoute: RouteObject = {
  Component,
  loader,
}