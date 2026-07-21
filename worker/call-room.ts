import { DurableObject } from 'cloudflare:workers'
import type { Env, PublishedTrack } from './types'

type CallState = {
  active: boolean
  groupId: string
  groupName: string
  startedBy: string
  startedByName: string
  startedAt: number
  tracks: PublishedTrack[]
}

export class CallRoom extends DurableObject<Env> {
  private state(): Promise<CallState | null> {
    return this.ctx.storage.get<CallState>('call')
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/state') {
      return Response.json((await this.state()) || { active: false, tracks: [] })
    }

    if (path === '/start' && request.method === 'POST') {
      const body = await request.json<{
        groupId: string
        groupName: string
        startedBy: string
        startedByName: string
      }>()
      const existing = await this.state()
      if (existing?.active) {
        return Response.json(existing)
      }
      const call: CallState = {
        active: true,
        groupId: body.groupId,
        groupName: body.groupName,
        startedBy: body.startedBy,
        startedByName: body.startedByName,
        startedAt: Date.now(),
        tracks: [],
      }
      await this.ctx.storage.put('call', call)
      return Response.json(call)
    }

    if (path === '/publish' && request.method === 'POST') {
      const track = await request.json<PublishedTrack>()
      const call = await this.state()
      if (!call?.active) return Response.json({ error: 'No active call' }, { status: 404 })
      call.tracks = call.tracks.filter((t) => t.userId !== track.userId)
      call.tracks.push(track)
      await this.ctx.storage.put('call', call)
      return Response.json(call)
    }

    if (path === '/unpublish' && request.method === 'POST') {
      const { userId } = await request.json<{ userId: string }>()
      const call = await this.state()
      if (!call) return Response.json({ active: false, tracks: [] })
      call.tracks = call.tracks.filter((t) => t.userId !== userId)
      if (call.tracks.length === 0) {
        call.active = false
      }
      await this.ctx.storage.put('call', call)
      return Response.json(call)
    }

    if (path === '/end' && request.method === 'POST') {
      const call = await this.state()
      if (call) {
        call.active = false
        call.tracks = []
        await this.ctx.storage.put('call', call)
      }
      return Response.json({ active: false, tracks: [] })
    }

    return new Response('Not found', { status: 404 })
  }
}

export function callRoomStub(env: Env, groupId: string) {
  return env.CALL_ROOM.get(env.CALL_ROOM.idFromName(groupId))
}
