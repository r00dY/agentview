"use client";
import { AgentView } from "agentview";

export const agentview = new AgentView({
  apiKey: process.env.AGENTVIEW_API_KEY,
});