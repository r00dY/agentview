"use client";

import "../studio.css";
import { Studio } from "@agentview/studio";
import config from "@/agentview.config";

export default function StudioPage() {
  return <Studio config={config} basename="/studio" />;
}
