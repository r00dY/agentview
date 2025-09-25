import React from "react";
import type { User } from "./shared/apiTypes";
import type { Session } from "better-auth";
import { authClient } from "./auth-client";

type a = ReturnType<typeof authClient.getSession>

export type SessionContextValue = {
//   session: Awaited<ReturnType<typeof authClient.getSession>>['data']
  user: User;
  members: User[];
  locale: string;
};

export const SessionContext = React.createContext<SessionContextValue | undefined>(
  undefined
);

export function useSessionContext(): SessionContextValue {
  const context = React.useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionContext must be used within a SessionContext.Provider");
  }
  return context;
}

