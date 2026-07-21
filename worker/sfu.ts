import type { Env } from './types'

const SFU = 'https://rtc.live.cloudflare.com/v1'

function configured(env: Env): boolean {
  const id = (env.CALLS_APP_ID || '').trim()
  const secret = (env.CALLS_APP_SECRET || '').trim()
  return Boolean(id && secret && !id.startsWith('REPLACE') && secret !== 'test')
}

export async function sfuFetch(env: Env, path: string, init: RequestInit = {}) {
  if (!configured(env)) {
    throw new Error('Realtime SFU not configured. Set CALLS_APP_ID and CALLS_APP_SECRET.')
  }
  const res = await fetch(`${SFU}/apps/${env.CALLS_APP_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CALLS_APP_SECRET}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { errorDescription?: string }).errorDescription || `SFU ${res.status}`)
  }
  return data
}

export async function createSession(env: Env) {
  return sfuFetch(env, '/sessions/new', { method: 'POST' }) as Promise<{ sessionId: string }>
}

export async function newTracks(env: Env, sessionId: string, body: unknown) {
  return sfuFetch(env, `/sessions/${sessionId}/tracks/new`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function renegotiate(env: Env, sessionId: string, body: unknown) {
  return sfuFetch(env, `/sessions/${sessionId}/renegotiate`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function closeTracks(env: Env, sessionId: string, body: unknown) {
  return sfuFetch(env, `/sessions/${sessionId}/tracks/close`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function sfuConfigured(env: Env) {
  return configured(env)
}
