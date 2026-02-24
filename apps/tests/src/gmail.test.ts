import { describe, test, expect, beforeAll } from 'vitest'
import { seedUsers } from './seedUsers'

const API_URL = process.env.VITE_AGENTVIEW_API_URL!

describe('Gmail', () => {
  let organization: { id: string }
  let adminAuthHeaders: Headers

  beforeAll(async () => {
    const orgSlug = 'gmail-test-' + Math.random().toString(36).slice(2)
    const result = await seedUsers(orgSlug)
    organization = result.organization

    // Sign in as admin and capture cookies via raw fetch
    adminAuthHeaders = new Headers()
    const signInRes = await fetch(`${API_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `admin@${orgSlug}.com`, password: 'blablabla' }),
    })
    const setCookie = signInRes.headers.get('set-cookie')
    if (setCookie) {
      const cookies = setCookie.split(',').map(c => c.split(';')[0].trim())
      adminAuthHeaders.set('Cookie', cookies.join('; '))
    }
    adminAuthHeaders.set('x-organization-id', organization.id)
    adminAuthHeaders.set('x-env', 'dev')
  })

  describe('GET /api/channels/gmail/auth', () => {
    test('requires authentication', async () => {
      const res = await fetch(`${API_URL}/api/channels/gmail/auth`)
      expect(res.status).toBe(401)
    })

    test('returns Google OAuth URL for admin (requires GMAIL_STATE_SECRET)', async () => {
      const res = await fetch(`${API_URL}/api/channels/gmail/auth`, {
        headers: adminAuthHeaders,
      })

      // If Gmail env vars aren't configured on the server, we get 400.
      // Skip the detailed assertions in that case.
      if (res.status === 400) {
        const body = await res.json() as { message: string }
        if (body.message.includes('secretOrPrivateKey')) {
          console.log('Skipping: GMAIL_STATE_SECRET not configured on server')
          return
        }
      }

      expect(res.status).toBe(200)
      const data = await res.json() as { url: string }
      expect(data.url).toBeDefined()
      expect(data.url).toContain('accounts.google.com')
      expect(data.url).toContain('gmail.readonly')
    })
  })

  describe('POST /api/channels/gmail/webhook', () => {
    test('handles unknown email gracefully (200)', async () => {
      const pubsubMessage = {
        message: {
          data: Buffer.from(JSON.stringify({
            emailAddress: 'unknown@example.com',
            historyId: '12345',
          })).toString('base64'),
        },
      }

      const res = await fetch(`${API_URL}/api/channels/gmail/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pubsubMessage),
      })
      expect(res.status).toBe(200)
      const data = await res.json() as { status: string }
      expect(data.status).toBe('ok')
    })

    test('handles malformed payload (200)', async () => {
      const res = await fetch(`${API_URL}/api/channels/gmail/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garbage: true }),
      })
      expect(res.status).toBe(200)
      const data = await res.json() as { status: string }
      expect(data.status).toBe('ok')
    })

    test('handles empty body (200)', async () => {
      const res = await fetch(`${API_URL}/api/channels/gmail/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
    })

    test('handles missing data field (200)', async () => {
      const res = await fetch(`${API_URL}/api/channels/gmail/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {} }),
      })
      expect(res.status).toBe(200)
    })
  })
})
