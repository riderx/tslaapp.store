import type { Env, FriendView, GroupView, UserRow } from './types'
import { bearer, cors, friendCode, hashToken, id, json, requireUser } from './auth'
import { closeTracks, createSession, newTracks, renegotiate, sfuConfigured } from './sfu'
import { getUserLocation, notifyUser, PresenceHub } from './presence'
import { callRoomStub, CallRoom } from './call-room'

export { PresenceHub, CallRoom }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const preflight = cors(request)
    if (preflight) return preflight

    const url = new URL(request.url)

    try {
      if (url.pathname === '/ws') {
        return handleWs(request, env, url)
      }

      if (url.pathname.startsWith('/api/')) {
        return handleApi(request, env, url)
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request)
      }
      return new Response('Not found', { status: 404 })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error'
      return json({ error: message }, 500)
    }
  },
}

async function handleWs(request: Request, env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') || bearer(request)
  if (!token) return new Response('Unauthorized', { status: 401 })
  const tokenHash = await hashToken(token)
  const user = await env.DB.prepare('SELECT * FROM users WHERE token_hash = ?')
    .bind(tokenHash)
    .first<UserRow>()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const stub = env.PRESENCE.get(env.PRESENCE.idFromName(user.id))
  const u = new URL(request.url)
  u.searchParams.set('userId', user.id)
  u.searchParams.set('name', user.name)
  return stub.fetch(new Request(u.toString(), request))
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/$/, '') || '/'

  if (path === '/api/health' && request.method === 'GET') {
    return json({ ok: true, sfu: sfuConfigured(env) })
  }

  if (path === '/api/register' && request.method === 'POST') {
    const body = await request.json<{ name?: string }>()
    const name = (body.name || '').trim().slice(0, 32)
    if (name.length < 2) return json({ error: 'Name required' }, 400)

    const userId = id()
    const token = id() + id()
    const tokenHash = await hashToken(token)
    let code = friendCode()
    for (let i = 0; i < 5; i++) {
      try {
        await env.DB.prepare(
          'INSERT INTO users (id, name, friend_code, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        )
          .bind(userId, name, code, tokenHash, Date.now())
          .run()
        break
      } catch {
        code = friendCode()
        if (i === 4) throw new Error('Could not allocate friend code')
      }
    }
    return json({
      user: { id: userId, name, friendCode: code },
      token,
    })
  }

  const userOrRes = await requireUser(request, env)
  if (userOrRes instanceof Response) return userOrRes
  const user = userOrRes

  if (path === '/api/me' && request.method === 'GET') {
    return json({
      user: { id: user.id, name: user.name, friendCode: user.friend_code },
      sfu: sfuConfigured(env),
    })
  }

  if (path === '/api/friends' && request.method === 'GET') {
    return json({ friends: await listFriends(env, user.id) })
  }

  if (path === '/api/friends/request' && request.method === 'POST') {
    const body = await request.json<{ code?: string }>()
    const code = (body.code || '').trim().toUpperCase()
    if (!code) return json({ error: 'Friend code required' }, 400)

    const target = await env.DB.prepare('SELECT * FROM users WHERE friend_code = ?')
      .bind(code)
      .first<UserRow>()
    if (!target) return json({ error: 'No user with that code' }, 404)
    if (target.id === user.id) return json({ error: 'Cannot add yourself' }, 400)

    const reverse = await env.DB.prepare(
      `SELECT status FROM friendships WHERE requester_id = ? AND addressee_id = ?`,
    )
      .bind(target.id, user.id)
      .first<{ status: string }>()

    if (reverse?.status === 'accepted') {
      return json({ friends: await listFriends(env, user.id), message: 'Already friends' })
    }

    // Reciprocal add → mutual accept
    if (reverse?.status === 'pending') {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
           VALUES (?, ?, 'accepted', ?)
           ON CONFLICT(requester_id, addressee_id) DO UPDATE SET status = 'accepted'`,
        ).bind(user.id, target.id, Date.now()),
        env.DB.prepare(
          `UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?`,
        ).bind(target.id, user.id),
      ])
      await notifyUser(env, target.id, {
        type: 'friend_accepted',
        friend: { id: user.id, name: user.name, friendCode: user.friend_code },
      })
      return json({ friends: await listFriends(env, user.id), message: 'You are now friends' })
    }

    await env.DB.prepare(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
       VALUES (?, ?, 'pending', ?)
       ON CONFLICT(requester_id, addressee_id) DO NOTHING`,
    )
      .bind(user.id, target.id, Date.now())
      .run()

    await notifyUser(env, target.id, {
      type: 'friend_request',
      from: { id: user.id, name: user.name, friendCode: user.friend_code },
    })

    return json({ friends: await listFriends(env, user.id), message: 'Request sent — they must add you back' })
  }

  if (path === '/api/friends/accept' && request.method === 'POST') {
    const body = await request.json<{ userId?: string }>()
    if (!body.userId) return json({ error: 'userId required' }, 400)
    const updated = await env.DB.prepare(
      `UPDATE friendships SET status = 'accepted'
       WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
    )
      .bind(body.userId, user.id)
      .run()
    if (!updated.meta.changes) return json({ error: 'No pending request' }, 404)

    await env.DB.prepare(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
       VALUES (?, ?, 'accepted', ?)
       ON CONFLICT(requester_id, addressee_id) DO UPDATE SET status = 'accepted'`,
    )
      .bind(user.id, body.userId, Date.now())
      .run()

    await notifyUser(env, body.userId, {
      type: 'friend_accepted',
      friend: { id: user.id, name: user.name, friendCode: user.friend_code },
    })
    return json({ friends: await listFriends(env, user.id) })
  }

  if (path === '/api/friends/locations' && request.method === 'GET') {
    const friends = (await listFriends(env, user.id)).filter((f) => f.status === 'accepted')
    const locations = await Promise.all(
      friends.map(async (f) => {
        const data = await getUserLocation(env, f.id)
        return {
          userId: f.id,
          name: f.name,
          location: data.location,
        }
      }),
    )
    return json({ locations: locations.filter((l) => l.location) })
  }

  if (path === '/api/presence/location' && request.method === 'POST') {
    const body = await request.json<{ lat?: number; lng?: number; heading?: number }>()
    if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
      return json({ error: 'lat/lng required' }, 400)
    }
    const stub = env.PRESENCE.get(env.PRESENCE.idFromName(user.id))
    // Store via DO websocket-less path: reuse notify + storage by posting through DO fetch
    // PresenceHub stores on WS messages; also store via a lightweight internal put using notify + location update
    await stub.fetch('https://presence/internal/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'noop' }),
    }).catch(() => null)

    // Direct storage via temporary websocket-less endpoint — patch: use location through dedicated path
    // We'll fan out to friends from here after writing via CallRoom-style internal API.
    // Add storage by connecting PresenceHub fetch for location set:
    await setLocation(env, user.id, user.name, body.lat, body.lng, body.heading)

    const friends = (await listFriends(env, user.id)).filter((f) => f.status === 'accepted')
    await Promise.all(
      friends.map((f) =>
        notifyUser(env, f.id, {
          type: 'friend_location',
          userId: user.id,
          name: user.name,
          lat: body.lat,
          lng: body.lng,
          heading: body.heading,
          updatedAt: Date.now(),
        }),
      ),
    )
    return json({ ok: true })
  }

  if (path === '/api/groups' && request.method === 'GET') {
    return json({ groups: await listGroups(env, user.id) })
  }

  if (path === '/api/groups' && request.method === 'POST') {
    const body = await request.json<{ name?: string; memberIds?: string[] }>()
    const name = (body.name || '').trim().slice(0, 40)
    if (name.length < 2) return json({ error: 'Group name required' }, 400)
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : []
    const friends = new Set(
      (await listFriends(env, user.id)).filter((f) => f.status === 'accepted').map((f) => f.id),
    )
    const groupId = id()
    const stmts = [
      env.DB.prepare(
        'INSERT INTO groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)',
      ).bind(groupId, name, user.id, Date.now()),
      env.DB.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').bind(
        groupId,
        user.id,
      ),
    ]
    for (const mid of memberIds) {
      if (friends.has(mid)) {
        stmts.push(
          env.DB.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').bind(
            groupId,
            mid,
          ),
        )
      }
    }
    await env.DB.batch(stmts)
    return json({ groups: await listGroups(env, user.id) })
  }

  const groupMemberMatch = path.match(/^\/api\/groups\/([^/]+)\/members$/)
  if (groupMemberMatch && request.method === 'POST') {
    const groupId = groupMemberMatch[1]
    const body = await request.json<{ userId?: string }>()
    if (!(await isGroupMember(env, groupId, user.id))) return json({ error: 'Forbidden' }, 403)
    if (!body.userId) return json({ error: 'userId required' }, 400)
    const friends = (await listFriends(env, user.id)).filter((f) => f.status === 'accepted')
    if (!friends.some((f) => f.id === body.userId)) return json({ error: 'Must be friends' }, 400)
    await env.DB.prepare(
      'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)',
    )
      .bind(groupId, body.userId)
      .run()
    return json({ groups: await listGroups(env, user.id) })
  }

  const callMatch = path.match(/^\/api\/groups\/([^/]+)\/call(?:\/(join|end|tracks|renegotiate))?$/)
  if (callMatch) {
    const groupId = callMatch[1]
    const action = callMatch[2] || 'start'
    if (!(await isGroupMember(env, groupId, user.id))) return json({ error: 'Forbidden' }, 403)
    const group = await env.DB.prepare('SELECT * FROM groups WHERE id = ?')
      .bind(groupId)
      .first<{ id: string; name: string }>()
    if (!group) return json({ error: 'Group not found' }, 404)
    const room = callRoomStub(env, groupId)

    if (action === 'start' && request.method === 'POST') {
      if (!sfuConfigured(env)) {
        return json(
          {
            error:
              'Realtime SFU not configured. Create a Calls app and set CALLS_APP_ID / CALLS_APP_SECRET.',
          },
          503,
        )
      }
      const stateRes = await room.fetch('https://call/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          groupName: group.name,
          startedBy: user.id,
          startedByName: user.name,
        }),
      })
      const call = await stateRes.json<any>()
      const members = await env.DB.prepare(
        'SELECT user_id FROM group_members WHERE group_id = ?',
      )
        .bind(groupId)
        .all<{ user_id: string }>()
      await Promise.all(
        (members.results || []).map((m) =>
          notifyUser(env, m.user_id, {
            type: 'ring',
            groupId,
            groupName: group.name,
            from: { id: user.id, name: user.name },
            startedAt: call.startedAt,
          }),
        ),
      )
      return json({ call })
    }

    if (action === 'join' && request.method === 'POST') {
      const state = await (await room.fetch('https://call/state')).json<any>()
      if (!state.active) return json({ error: 'No active call' }, 404)
      const session = await createSession(env)
      return json({
        call: state,
        sessionId: session.sessionId,
        tracks: state.tracks.filter((t: any) => t.userId !== user.id),
      })
    }

    if (action === 'tracks' && request.method === 'POST') {
      const body = await request.json<{
        sessionId: string
        sessionDescription?: { sdp: string; type: string }
        tracks: any[]
        publish?: { trackName: string }
      }>()
      const result = await newTracks(env, body.sessionId, {
        sessionDescription: body.sessionDescription,
        tracks: body.tracks,
      })
      if (body.publish?.trackName) {
        const stateRes = await room.fetch('https://call/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            name: user.name,
            sessionId: body.sessionId,
            trackName: body.publish.trackName,
          }),
        })
        const call = await stateRes.json<any>()
        const members = await env.DB.prepare(
          'SELECT user_id FROM group_members WHERE group_id = ?',
        )
          .bind(groupId)
          .all<{ user_id: string }>()
        await Promise.all(
          (members.results || [])
            .filter((m) => m.user_id !== user.id)
            .map((m) =>
              notifyUser(env, m.user_id, {
                type: 'track_published',
                groupId,
                track: {
                  userId: user.id,
                  name: user.name,
                  sessionId: body.sessionId,
                  trackName: body.publish!.trackName,
                },
              }),
            ),
        )
        return json({ result, call })
      }
      return json({ result })
    }

    if (action === 'renegotiate' && request.method === 'POST') {
      const body = await request.json<{
        sessionId: string
        sessionDescription: { sdp: string; type: string }
      }>()
      const result = await renegotiate(env, body.sessionId, {
        sessionDescription: body.sessionDescription,
      })
      return json({ result })
    }

    if (action === 'end' && request.method === 'POST') {
      const body = await request.json<{ sessionId?: string; trackName?: string }>().catch(() => ({} as any))
      if (body.sessionId && body.trackName) {
        await closeTracks(env, body.sessionId, {
          tracks: [{ mid: undefined, trackName: body.trackName }],
          force: true,
        }).catch(() => null)
      }
      await room.fetch('https://call/unpublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      const state = await (await room.fetch('https://call/state')).json<any>()
      if (!state.active || (state.tracks || []).length === 0) {
        await room.fetch('https://call/end', { method: 'POST' })
        const members = await env.DB.prepare(
          'SELECT user_id FROM group_members WHERE group_id = ?',
        )
          .bind(groupId)
          .all<{ user_id: string }>()
        await Promise.all(
          (members.results || []).map((m) =>
            notifyUser(env, m.user_id, { type: 'call_ended', groupId }),
          ),
        )
      }
      return json({ ok: true })
    }
  }

  return json({ error: 'Not found' }, 404)
}

async function setLocation(
  env: Env,
  userId: string,
  name: string,
  lat: number,
  lng: number,
  heading?: number,
) {
  // PresenceHub stores location on WS; also keep a lightweight mirror via DO storage by
  // sending a synthetic websocket-less update through a dedicated internal endpoint.
  const stub = env.PRESENCE.get(env.PRESENCE.idFromName(userId))
  // Use alarm-free approach: call notify with location_store handled in PresenceHub
  // Extend PresenceHub with /internal/set-location
  await stub.fetch('https://presence/internal/set-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, lat, lng, heading }),
  })
}

async function listFriends(env: Env, userId: string): Promise<FriendView[]> {
  const outgoing = await env.DB.prepare(
    `SELECT u.id, u.name, u.friend_code, f.status
     FROM friendships f JOIN users u ON u.id = f.addressee_id
     WHERE f.requester_id = ?`,
  )
    .bind(userId)
    .all<{ id: string; name: string; friend_code: string; status: 'pending' | 'accepted' }>()

  const incoming = await env.DB.prepare(
    `SELECT u.id, u.name, u.friend_code, f.status
     FROM friendships f JOIN users u ON u.id = f.requester_id
     WHERE f.addressee_id = ?`,
  )
    .bind(userId)
    .all<{ id: string; name: string; friend_code: string; status: 'pending' | 'accepted' }>()

  const map = new Map<string, FriendView>()
  for (const row of outgoing.results || []) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      friendCode: row.friend_code,
      status: row.status,
      direction: row.status === 'accepted' ? 'mutual' : 'outgoing',
    })
  }
  for (const row of incoming.results || []) {
    const existing = map.get(row.id)
    if (existing) {
      if (row.status === 'accepted' || existing.status === 'accepted') {
        existing.status = 'accepted'
        existing.direction = 'mutual'
      }
    } else {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        friendCode: row.friend_code,
        status: row.status,
        direction: row.status === 'accepted' ? 'mutual' : 'incoming',
      })
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function listGroups(env: Env, userId: string): Promise<GroupView[]> {
  const groups = await env.DB.prepare(
    `SELECT g.id, g.name, g.owner_id
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.created_at DESC`,
  )
    .bind(userId)
    .all<{ id: string; name: string; owner_id: string }>()

  const result: GroupView[] = []
  for (const g of groups.results || []) {
    const members = await env.DB.prepare(
      `SELECT u.id, u.name, u.friend_code
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?`,
    )
      .bind(g.id)
      .all<{ id: string; name: string; friend_code: string }>()
    result.push({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      members: (members.results || []).map((m) => ({
        id: m.id,
        name: m.name,
        friendCode: m.friend_code,
      })),
    })
  }
  return result
}

async function isGroupMember(env: Env, groupId: string, userId: string) {
  const row = await env.DB.prepare(
    'SELECT 1 as ok FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(groupId, userId)
    .first()
  return Boolean(row)
}
