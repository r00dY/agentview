import { useEffect, useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { getWebAppUrl } from "agentview/urls";
import type { AgentViewConfig } from "./types";

type Router = ReturnType<typeof createBrowserRouter>;

export interface StudioProps {
  config: AgentViewConfig;
  basename?: string;
}

export function Studio({ config, basename }: StudioProps) {
  const [router, setRouter] = useState<Router | null>(null);

  if (window.location.hostname === new URL(getWebAppUrl()).hostname) { // sanity check for local dev
    throw new Error(
      `Studio cannot run on the AgentView webapp domain (${window.location.hostname}). Host Studio on your own domain.`,
    );
  }

  useEffect(() => {
    (window as any).agentview = { config, basename };
    let cancelled = false;

    import("./routes").then(({ routes }) => {
      if (cancelled) return;
      const r = createBrowserRouter(routes(config.customRoutes), { basename });
      (window as any).agentview.router = r;
      setRouter(r);
    });

    return () => {
      cancelled = true;
    };
  }, [config, basename]);

  if (!router) return null;

  return (
    <div id="agentview-root">
      <RouterProvider router={router} unstable_useTransitions={true} />
    </div>
  );
}
