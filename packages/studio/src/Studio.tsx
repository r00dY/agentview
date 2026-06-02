import { useEffect, useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import type { AgentViewConfig } from "./types";

type Router = ReturnType<typeof createBrowserRouter>;

export interface StudioProps {
  config: AgentViewConfig;
  basename?: string;
}

export function Studio({ config, basename }: StudioProps) {
  const [router, setRouter] = useState<Router | null>(null);

  useEffect(() => {
    (window as any).agentview = { config };
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
