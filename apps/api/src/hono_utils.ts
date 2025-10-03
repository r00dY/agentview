import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'

export function response_data<T extends z.ZodTypeAny>(schema: T, description?: string) {
    return {
      content: {
        'application/json': {
          schema,
        },
      },
      description: description ?? 'Undescribed',
    }
  }
  
  export function response_error<T extends z.ZodTypeAny>(description?: string) {
    return {
      content: {
        'application/json': {
          schema: z.object({ message: z.string(), code: z.string().optional() }),
        },
      },
      description: description ?? 'Undescribed',
    }
  }
  
  export function body<T extends z.ZodTypeAny>(schema: T) {
    return {
      content: {
        'application/json': {
          schema,
        },
      }
    }
  }
  