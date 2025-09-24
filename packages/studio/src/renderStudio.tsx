import { RouterProvider } from "react-router";
import type { AgentViewConfig } from "./types";
import { createRoot } from "react-dom/client";

export async function renderStudio(rootElement: HTMLElement | null, config: AgentViewConfig) {
  if (!rootElement) {
    throw new Error("Root element not found");
  }
  (window as any).agentview = {
    config
  }

  import("./routes").then(({ router }) => {
    const root = createRoot(rootElement);
    root.render(<RouterProvider router={router} />)
  })
}