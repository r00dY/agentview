import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';

// -- Context types --

export interface LogContext {
  requestId?: string;
  organizationId?: string;
  principalType?: string;
  workerName?: string;
  runId?: string;
  sessionId?: string;
  channelType?: string;
  [key: string]: unknown;
}

// -- AsyncLocalStorage --

const als = new AsyncLocalStorage<LogContext>();

export function getContext(): LogContext {
  return als.getStore() ?? {};
}

export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run({ ...ctx }, fn);
}

export function setContext(partial: Partial<LogContext>): void {
  const store = als.getStore();
  if (store) {
    Object.assign(store, partial);
  }
}

// -- Pino setup --

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL ?? 'info';

const streams: pino.StreamEntry[] = [];

if (isDev) {
  streams.push({
    level: level as pino.Level,
    stream: await import('pino-pretty').then((m) =>
      m.default({ colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service,requestId', customColors: 'message:white,info:green,warn:yellow,error:red,fatal:red,debug:blue,trace:gray,default:white' })
    ),
  });
} else {
  streams.push({ level: level as pino.Level, stream: process.stdout });
}

if (process.env.LOG_FILE) {
  const fs = await import('node:fs');
  streams.push({
    level: level as pino.Level,
    stream: fs.createWriteStream(process.env.LOG_FILE, { flags: 'a' }),
  });
}

export const log = pino(
  {
    level,
    mixin() {
      return { ...getContext() };
    },
    base: { service: 'agentview-api' },
  },
  pino.multistream(streams),
);
