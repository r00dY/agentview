import type { Session, StandardSession } from "agentview/apiTypes";
import { adapters } from "./adapters/adapters";

export function standardToDefaultSession(session: StandardSession): Session {
    const adapter = adapters["ai-sdk"];
    const aisdkFields = adapter.enrichSession(session);
    const { runs, ...sessionBase } = session;
    return { ...sessionBase, ...aisdkFields };
  }
  