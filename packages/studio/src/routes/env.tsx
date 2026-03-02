import { TerminalIcon } from "lucide-react";
import { data, useLoaderData } from "react-router";
import type { RouteObject } from "react-router";

import { Header, HeaderTitle } from "../components/header";
import { Button } from "../components/ui/button";
import { requireEnvironment } from "../lib/environment";
// import { useSessionContext } from "../lib/SessionContext";
import { PropertyList, PropertyListTextValue, PropertyListItem, PropertyListTitle } from "../components/PropertyList";

async function loader() {
  const environment = await requireEnvironment();
  return { environment };
}

function Component() {
  const { environment } = useLoaderData<typeof loader>();
  // const { organization } = useSessionContext()
  // const configEnvOwner = organization.members.find(m => m.userId === environment.user.id);

  return <div>
    <Header>
      <HeaderTitle title="Config" />
    </Header>

    <div className="p-6 max-w-6xl">
      <div>
        <PropertyList>
          <PropertyListItem>
            <PropertyListTitle>Environment</PropertyListTitle>
            <PropertyListTextValue>
              {environment.user === null && "production"}
              {environment.user !== null && `dev (${environment.user.email})`}
            </PropertyListTextValue>
          </PropertyListItem>

        </PropertyList>
        
        <Button variant="outline" onClick={() => {
          console.log(environment.config);
        }} className="mt-4"><TerminalIcon /> Print config to console</Button>
        <pre className="bg-muted p-4 rounded overflow-x-auto text-sm mt-4">
          {JSON.stringify(environment.config, null, 2)}
        </pre>
      </div>
    </div>
  </div>
}

export const envRoute: RouteObject = {
  Component,
  loader,
}