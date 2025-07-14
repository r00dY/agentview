import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'

export function response_data<T extends z.ZodTypeAny>(schema: T, description?: string) {
    return {
      content: {
        'application/json': {
          schema: z.object({
            data: schema,
          }),
        },
      },
      description: description ?? 'Undescribed',
    }
  }
  
  export function response_error<T extends z.ZodTypeAny>(description?: string) {
    return {
      content: {
        'application/json': {
          schema: z.object({ error: z.string() }),
        },
      },
      description: description ?? 'Undescribed',
    }
  }
  
  export function body<T extends z.ZodTypeAny>(schema: T) {
    return {
      content: {
        'application/json': {
          schema: schema,
        },
      }
    }
  }
  