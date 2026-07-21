import { DurableObject } from 'cloudflare:workers'
import type { Env } from './types'

type Loc = { lat: number; lng: number; heading?: number; updatedAt: number }

export class PresenceHub extends DurableObject<Env> {
  private sockets = new Map<WebSocket, { userId: string; name: string }>()

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/internal/notify' && request.method === 'POST') {
      const msg = await request.json()
      this.broadcast(msg)
      return Response.json({ ok: true })
    }

    if (url.pathname === '/internal/location' && request.method === 'GET') {
      const loc = (await this.ctx.storage.get<Loc>('location')) || null
      const meta = (await this.ctx.storage.get<{ name: string }>('meta')) || null
      return Response.json({ location: loc, name: meta?.name || null })
    }

    if (url.pathname === '/internal/set-location' && request.method === 'POST') {
      const body = await request.json<{ name: string; lat: number; lng: number; heading?: number }>()
      await this.ctx.storage.put('meta', { name: body.name })
      await this.ctx.storage.put('location', {
        lat: body.lat,
        lng: body.lng,
        heading: body.heading,
        updatedAt: Date.now(),
      } satisfies Loc)
      return Response.json({ ok: true })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const userId = url.searchParams.get('userId') || ''
    const name = url.searchParams.get('name') || 'Driver'
    if (!userId) return new Response('Missing userId', { status: 400 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    this.sockets.set(server, { userId, name })
    await this.ctx.storage.put('meta', { name, userId })
    server.send(JSON.stringify({ type: 'hello', userId }))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    let data: any
    try {
      data = JSON.parse(message)
    } catch {
      return
    }
    const meta = this.sockets.get(ws)
    if (!meta) return

    if (data.type === 'location' && typeof data.lat === 'number' && typeof data.lng === 'number') {
      const loc: Loc = {
        lat: data.lat,
        lng: data.lng,
        heading: typeof data.heading === 'number' ? data.heading : undefined,
        updatedAt: Date.now(),
      }
      await this.ctx.storage.put('location', loc)
      // Fan-out to mutual friends is handled by the Worker after this message.
      ws.send(JSON.stringify({ type: 'location_ack' }))
      return
    }

    if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }))
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.sockets.delete(ws)
  }

  async webSocketError(ws: WebSocket) {
    this.sockets.delete(ws)
  }

  private broadcast(msg: unknown) {
    const raw = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(raw)
      } catch {
        /* ignore */
      }
    }
  }
}

export async function notifyUser(env: Env, userId: string, msg: unknown) {
  const id = env.PRESENCE.idFromName(userId)
  const stub = env.PRESENCE.get(id)
  await stub.fetch('https://presence/internal/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  })
}

export async function getUserLocation(env: Env, userId: string) {
  const id = env.PRESENCE.idFromName(userId)
  const stub = env.PRESENCE.get(id)
  const res = await stub.fetch('https://presence/internal/location')
  return res.json() as Promise<{ location: Loc | null; name: string | null }>
}
