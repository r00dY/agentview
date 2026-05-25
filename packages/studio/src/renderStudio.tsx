import { createRoot, type Root } from "react-dom/client";
import type { AgentViewConfig } from "./types";
import { Studio } from "./Studio";

export interface RenderStudioOptions {
  basename?: string;
}

export interface StudioHandle {
  unmount: () => void;
}

export async function renderStudio(
  rootElement: HTMLElement | null,
  config: AgentViewConfig,
  options: RenderStudioOptions = {},
): Promise<StudioHandle> {
  if (!rootElement) {
    throw new Error("Root element not found");
  }

  const root: Root = createRoot(rootElement);
  root.render(<Studio config={config} basename={options.basename} />);

  return {
    unmount: () => {
      root.unmount();
    },
  };
}
