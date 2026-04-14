import type { UIMessageChunk, ProviderMetadata } from 'ai';

/**
 * V7 beta chunk type – not yet in ai@6.x types.
 */
export type CustomUIMessageChunk = {
  type: 'custom';
  kind: `${string}.${string}`;
  providerMetadata?: ProviderMetadata;
};

export type ExtendedUIMessageChunk = UIMessageChunk | CustomUIMessageChunk;

export class ChunkParseError extends Error {
  readonly body: unknown;

  constructor(message: string, body: unknown) {
    super(message);
    this.name = 'ChunkParseError';
    this.body = body;
  }
}

// --- Allowed-key sets per chunk type (strictObject equivalent) ---

const K_TEXT_DELTA        = new Set(['type', 'id', 'delta', 'providerMetadata']);
const K_REASONING_DELTA   = new Set(['type', 'id', 'delta', 'providerMetadata']);
const K_TOOL_INPUT_DELTA  = new Set(['type', 'toolCallId', 'inputTextDelta']);

const K_TEXT_START        = new Set(['type', 'id', 'providerMetadata']);
const K_TEXT_END          = new Set(['type', 'id', 'providerMetadata']);
const K_REASONING_START   = new Set(['type', 'id', 'providerMetadata']);
const K_REASONING_END     = new Set(['type', 'id', 'providerMetadata']);

const K_TOOL_INPUT_START     = new Set(['type', 'toolCallId', 'toolName', 'providerExecuted', 'providerMetadata', 'dynamic', 'title']);
const K_TOOL_INPUT_AVAILABLE = new Set(['type', 'toolCallId', 'toolName', 'input', 'providerExecuted', 'providerMetadata', 'dynamic', 'title']);
const K_TOOL_INPUT_ERROR     = new Set(['type', 'toolCallId', 'toolName', 'input', 'providerExecuted', 'providerMetadata', 'dynamic', 'errorText', 'title']);

const K_TOOL_APPROVAL_REQUEST  = new Set(['type', 'approvalId', 'toolCallId']);
const K_TOOL_OUTPUT_AVAILABLE  = new Set(['type', 'toolCallId', 'output', 'providerExecuted', 'providerMetadata', 'dynamic', 'preliminary']);
const K_TOOL_OUTPUT_ERROR      = new Set(['type', 'toolCallId', 'errorText', 'providerExecuted', 'providerMetadata', 'dynamic']);
const K_TOOL_OUTPUT_DENIED     = new Set(['type', 'toolCallId']);

const K_SOURCE_URL      = new Set(['type', 'sourceId', 'url', 'title', 'providerMetadata']);
const K_SOURCE_DOCUMENT = new Set(['type', 'sourceId', 'mediaType', 'title', 'filename', 'providerMetadata']);
const K_FILE            = new Set(['type', 'url', 'mediaType', 'providerMetadata']);

const K_START_STEP  = new Set(['type']);
const K_FINISH_STEP = new Set(['type']);

const K_START             = new Set(['type', 'messageId', 'messageMetadata']);
const K_FINISH            = new Set(['type', 'finishReason', 'messageMetadata']);
const K_MESSAGE_METADATA  = new Set(['type', 'messageMetadata']);
const K_ERROR             = new Set(['type', 'errorText']);
const K_ABORT             = new Set(['type', 'reason']);

const K_CUSTOM = new Set(['type', 'kind', 'providerMetadata']);
const K_DATA   = new Set(['type', 'id', 'data', 'transient']);

// --- Helpers ---

function strictKeys(obj: any, allowed: Set<string>): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new ChunkParseError(
        `"${obj.type}" chunk: unexpected key "${key}"`,
        obj,
      );
    }
  }
}

function requireString(obj: any, field: string): void {
  if (typeof obj[field] !== 'string') {
    throw new ChunkParseError(
      `"${obj.type}" chunk: "${field}" must be a string, got ${typeof obj[field]}`,
      obj,
    );
  }
}

/**
 * Sync parse + validate a stringified UIMessageChunk.
 * Discriminated-union switch ordered by frequency (deltas first).
 * Strict: rejects unknown keys (like z.strictObject).
 */
export function parseUIMessageChunk(raw: string): ExtendedUIMessageChunk {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ChunkParseError(`Invalid JSON: ${raw.slice(0, 200)}`, raw);
  }

  if (obj == null || typeof obj !== 'object') {
    throw new ChunkParseError(`Expected object, got ${typeof obj}`, obj);
  }

  const type = obj.type;
  if (typeof type !== 'string') {
    throw new ChunkParseError('Missing or invalid "type" field', obj);
  }

  switch (type) {
    // --- Delta chunks (hot path, most frequent) ---

    case 'text-delta':
      strictKeys(obj, K_TEXT_DELTA);
      requireString(obj, 'id');
      requireString(obj, 'delta');
      return obj;

    case 'reasoning-delta':
      strictKeys(obj, K_REASONING_DELTA);
      requireString(obj, 'id');
      requireString(obj, 'delta');
      return obj;

    case 'tool-input-delta':
      strictKeys(obj, K_TOOL_INPUT_DELTA);
      requireString(obj, 'toolCallId');
      requireString(obj, 'inputTextDelta');
      return obj;

    // --- Text lifecycle ---

    case 'text-start':
      strictKeys(obj, K_TEXT_START);
      requireString(obj, 'id');
      return obj;

    case 'text-end':
      strictKeys(obj, K_TEXT_END);
      requireString(obj, 'id');
      return obj;

    // --- Reasoning lifecycle ---

    case 'reasoning-start':
      strictKeys(obj, K_REASONING_START);
      requireString(obj, 'id');
      return obj;

    case 'reasoning-end':
      strictKeys(obj, K_REASONING_END);
      requireString(obj, 'id');
      return obj;

    // --- Tool input ---

    case 'tool-input-start':
      strictKeys(obj, K_TOOL_INPUT_START);
      requireString(obj, 'toolCallId');
      requireString(obj, 'toolName');
      return obj;

    case 'tool-input-available':
      strictKeys(obj, K_TOOL_INPUT_AVAILABLE);
      requireString(obj, 'toolCallId');
      requireString(obj, 'toolName');
      return obj;

    case 'tool-input-error':
      strictKeys(obj, K_TOOL_INPUT_ERROR);
      requireString(obj, 'toolCallId');
      requireString(obj, 'toolName');
      requireString(obj, 'errorText');
      return obj;

    // --- Tool output ---

    case 'tool-approval-request':
      strictKeys(obj, K_TOOL_APPROVAL_REQUEST);
      requireString(obj, 'approvalId');
      requireString(obj, 'toolCallId');
      return obj;

    case 'tool-output-available':
      strictKeys(obj, K_TOOL_OUTPUT_AVAILABLE);
      requireString(obj, 'toolCallId');
      return obj;

    case 'tool-output-error':
      strictKeys(obj, K_TOOL_OUTPUT_ERROR);
      requireString(obj, 'toolCallId');
      requireString(obj, 'errorText');
      return obj;

    case 'tool-output-denied':
      strictKeys(obj, K_TOOL_OUTPUT_DENIED);
      requireString(obj, 'toolCallId');
      return obj;

    // --- Sources ---

    case 'source-url':
      strictKeys(obj, K_SOURCE_URL);
      requireString(obj, 'sourceId');
      requireString(obj, 'url');
      return obj;

    case 'source-document':
      strictKeys(obj, K_SOURCE_DOCUMENT);
      requireString(obj, 'sourceId');
      requireString(obj, 'mediaType');
      requireString(obj, 'title');
      return obj;

    // --- File ---

    case 'file':
      strictKeys(obj, K_FILE);
      requireString(obj, 'url');
      requireString(obj, 'mediaType');
      return obj;

    // --- Step boundaries ---

    case 'start-step':
      strictKeys(obj, K_START_STEP);
      return obj;

    case 'finish-step':
      strictKeys(obj, K_FINISH_STEP);
      return obj;

    // --- Stream lifecycle ---

    case 'start':
      strictKeys(obj, K_START);
      return obj;

    case 'finish':
      strictKeys(obj, K_FINISH);
      return obj;

    case 'message-metadata':
      strictKeys(obj, K_MESSAGE_METADATA);
      return obj;

    case 'error':
      strictKeys(obj, K_ERROR);
      requireString(obj, 'errorText');
      return obj;

    case 'abort':
      strictKeys(obj, K_ABORT);
      return obj;

    // --- V7 beta: custom ---

    case 'custom':
      strictKeys(obj, K_CUSTOM);
      requireString(obj, 'kind');
      if (!obj.kind.includes('.')) {
        throw new ChunkParseError(
          `"custom" chunk "kind" must match "namespace.name", got "${obj.kind}"`,
          obj,
        );
      }
      return obj as CustomUIMessageChunk;

    default:
      // data-* chunks
      if (type.startsWith('data-')) {
        strictKeys(obj, K_DATA);
        return obj;
      }
      throw new ChunkParseError(`Unknown chunk type: "${type}"`, obj);
  }
}
