export type MockOutboxEntry = {
  sourceId: string;
  sourceThreadId: string;
  address: string;
  text: string | null;
  timestamp: number;
};

/** In-memory outbox for testing — lives in the HTTP server process */
export const mockOutbox: MockOutboxEntry[] = [];