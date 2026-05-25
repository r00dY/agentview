import { createBrowserRouter, RouterProvider } from "react-router";
import type { AgentViewConfig } from "./types";
import { createRoot } from "react-dom/client";

export async function renderStudio(rootElement: HTMLElement | null, config: AgentViewConfig) {
  if (!rootElement) {
    throw new Error("Root element not found");
  }

  (window as any).agentview = {
    config
  }

  import("./routes").then(({ routes }) => {
    const root = createRoot(rootElement);
    const router = createBrowserRouter(routes(config.customRoutes));

    (window as any).agentview.router = router;
    
    root.render(<div className="agentview-root">
      <RouterProvider router={router} unstable_useTransitions={true} />
    </div>)
  })
}