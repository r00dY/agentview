import { db } from './db'
import { clients, clientAuthSessions } from './schemas/schema'
import { eq, and, gt } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import jwt from 'jsonwebtoken'


export async function createClient(externalId?: string) {
  const [newClient] = await db.insert(clients).values({
    external_id: externalId ?? null,
    isShared: false,
    simulatedBy: null,
  }).returning()

  return newClient
}

export async function createClientAuthSession(
  clientId: string,
  options?: {
    ipAddress?: string
    userAgent?: string
    expiresInHours?: number
  }
) {
  const expiresInHours = options?.expiresInHours ?? 24 * 7 // Default 7 days
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
  
  const [session] = await db.insert(clientAuthSessions).values({
    clientId,
    token: generateClientToken(),
    expiresAt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ipAddress: options?.ipAddress,
    userAgent: options?.userAgent,
  }).returning()

  return session
}

export async function getClientAuthSession(options?: { token?: string, headers?: Headers }) {
  const token = options?.token ?? extractClientToken(options?.headers ?? new Headers())
  if (!token) {
    return undefined;
  }

  const session = await db.query.clientAuthSessions.findFirst({
    where: and(
      eq(clientAuthSessions.token, token),
      gt(clientAuthSessions.expiresAt, new Date().toISOString())
    ),
    with: {
      client: true
    }
  })
  
  return session;
}

export function generateClientToken(): string {
  return randomBytes(32).toString('hex')
}

export function extractClientToken(headers: Headers): string | null {
  const authHeader = headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.substring(7) // Remove 'Bearer ' prefix
}

export function verifyJWT(token: string): { external_id: string } | null {
  try {
    const decoded = jwt.verify(token, process.env.AGENTVIEW_SECRET_KEY!) as any

    if (!decoded || !decoded.external_id) {
      return null
    }
    
    return { external_id: decoded.external_id }
  } catch (error) {
    return null
  }
}

export async function findClientByExternalId(externalId: string) {
  const client = await db.query.clients.findFirst({
    where: eq(clients.external_id, externalId)
  })
  
  return client
}
