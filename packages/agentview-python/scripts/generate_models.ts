import { z } from 'zod'
import * as fs from 'fs'
import { execSync } from 'child_process'
import * as schemas from '../../agentview/src/apiTypes.js'

// Schemas to export for Python SDK
const schemasToExport: Record<string, z.ZodTypeAny> = {
  // Enums
  Space: schemas.SpaceSchema,

  // Core entities
  User: schemas.UserSchema,
  UserCreate: schemas.UserCreateSchema,

  Session: schemas.SessionSchema,
  SessionBase: schemas.SessionBaseSchema,
  SessionCreate: schemas.SessionCreateSchema,
  SessionUpdate: schemas.SessionUpdateSchema,

  Run: schemas.RunSchema,
  RunCreate: schemas.RunCreateSchema,
  ManualRunCreate: schemas.ManualRunCreateSchema,
  ManualRunUpdate: schemas.ManualRunUpdateSchema,

  SessionItem: schemas.SessionItemSchema,
  SessionItemWithCollaboration: schemas.SessionItemWithCollaborationSchema,

  Score: schemas.ScoreSchema,
  ScoreCreate: schemas.ScoreCreateSchema,
  CommentMessage: schemas.CommentMessageSchema,

  Version: schemas.VersionSchema,

  Config: schemas.ConfigSchema,
  ConfigCreate: schemas.ConfigCreateSchema,

  Member: schemas.MemberSchema,
  MemberUpdate: schemas.MemberUpdateSchema,
  Invitation: schemas.InvitationSchema,
  InvitationCreate: schemas.InvitationCreateSchema,

  // Pagination
  Pagination: schemas.PaginationSchema,
  SessionsPaginatedResponse: schemas.SessionsPaginatedResponseSchema,

  // Query params
  SessionsGetQueryParams: schemas.SessionsGetQueryParamsSchema,
  PublicSessionsGetQueryParams: schemas.PublicSessionsGetQueryParamsSchema,

  // Webhook
  RunBody: schemas.RunBodySchema,
}

// Generate combined JSON Schema
const jsonSchema: {
  $schema: string
  $defs: Record<string, unknown>
} = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $defs: {},
}

for (const [name, schema] of Object.entries(schemasToExport)) {
  try {
    jsonSchema.$defs[name] = z.toJSONSchema(schema, { unrepresentable: 'any' })
  } catch (e) {
    console.warn(`Warning: Could not convert ${name} to JSON Schema:`, e)
  }
}

// Write JSON Schema
const schemaDir = new URL('../generated', import.meta.url).pathname
fs.mkdirSync(schemaDir, { recursive: true })
const schemaPath = `${schemaDir}/schema.json`
fs.writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, 2))
console.log(`JSON Schema written to ${schemaPath}`)

// Generate Pydantic models using datamodel-code-generator
const outputPath = new URL('../src/agentview/models.py', import.meta.url).pathname

try {
  execSync(
    `datamodel-codegen \
      --input "${schemaPath}" \
      --output "${outputPath}" \
      --input-file-type jsonschema \
      --output-model-type pydantic_v2.BaseModel \
      --use-standard-collections \
      --use-union-operator \
      --field-constraints \
      --capitalise-enum-members \
      --use-field-description \
      --target-python-version 3.10 \
      --use-double-quotes \
      --collapse-root-models`,
    { stdio: 'inherit' }
  )
  console.log(`Pydantic models generated at ${outputPath}`)
} catch (e) {
  console.error('Failed to generate Pydantic models. Make sure datamodel-code-generator is installed:')
  console.error('  pip install datamodel-code-generator')
  process.exit(1)
}
