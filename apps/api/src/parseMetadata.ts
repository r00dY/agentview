import { z } from '@hono/zod-openapi';
import { AgentViewError } from 'agentview/AgentViewError';
import type { Metadata } from 'agentview/baseConfigTypes';

export function parseMetadata(metadataConfig: Metadata | undefined, allowUnknownKeys: boolean = true, inputMetadata: Record<string, any> | undefined | null, existingMetadata: Record<string, any> | undefined | null): Record<string, any> {
  const metafields = metadataConfig ?? {};

  for (const [key, value] of Object.entries(metafields)) {
    if (value.safeParse(null).success && !(value instanceof z.ZodDefault)) {
      metafields[key] = value.default(null); // nullable fields without default should default to null
    }
  }

  let schema = z.object(metafields);
  if (allowUnknownKeys) {
    schema = schema.loose();
  } else {
    schema = schema.strict();
  }

  const metadata = {
    ...(existingMetadata ?? {}), // existing metadata overrides nulls
    ...(inputMetadata ?? {}), // input overrides existing metadata
  }

  const result = schema.safeParse(metadata);
  if (!result.success) {
    throw new AgentViewError("Error parsing the metadata.", 422, { code: 'parse.schema', issues: result.error.issues });
  }
  return result.data;
}
