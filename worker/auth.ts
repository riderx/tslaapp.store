import type { Env, UserRow } from './types'

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization')
  if (!h?.startsWith('Bearer ')) return null
  return h.slice(7).trim() || null
}

export async function requireUser(request: Request, env: Env): Promise<UserRow | Response> {
  const token = bearer(request)
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const tokenHash = await hashToken(token)
  const user = await env.DB.prepare('SELECT * FROM users WHERE token_hash = ?')
    .bind(tokenHash)
    .first<UserRow>()
  if (!user) return json({ error: 'Unauthorized' }, 401)
  return user
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  })
}

export function cors(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
    })
  }
  return null
}

export function friendCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

export function id(): string {
  return crypto.randomUUID()
}
