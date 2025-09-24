import { RouterProvider } from "react-router";
import type { AgentViewConfig } from "./types";
import { createRoot } from "react-dom/client";

export async function renderStudio(config: AgentViewConfig) {
  const container = document.getElementById("agentview");
  if (!container) {
    throw new Error("Root element not found");
  }
  const root = createRoot(container);

  (window as any).agentview = {
    config
  }

  import("./routes").then(({ router }) => {
    root.render(<RouterProvider router={router} />)
  })
}