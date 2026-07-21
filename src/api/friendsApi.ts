const TOKEN_KEY = 'tslap.friends.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(path, { ...init, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  return data as T
}

export type User = { id: string; name: string; friendCode: string }
export type Friend = {
  id: string
  name: string
  friendCode: string
  status: 'pending' | 'accepted'
  direction: 'outgoing' | 'incoming' | 'mutual'
}
export type Group = {
  id: string
  name: string
  ownerId: string
  members: { id: string; name: string; friendCode: string }[]
}
export type FriendLocation = {
  userId: string
  name: string
  location: { lat: number; lng: number; heading?: number; updatedAt: number }
}

export const friendsApi = {
  health: () => api<{ ok: boolean; sfu: boolean }>('/api/health'),
  register: (name: string) =>
    api<{ user: User; token: string }>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  me: () => api<{ user: User; sfu: boolean }>('/api/me'),
  friends: () => api<{ friends: Friend[] }>('/api/friends'),
  requestFriend: (code: string) =>
    api<{ friends: Friend[]; message?: string }>('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  acceptFriend: (userId: string) =>
    api<{ friends: Friend[] }>('/api/friends/accept', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  locations: () => api<{ locations: FriendLocation[] }>('/api/friends/locations'),
  shareLocation: (lat: number, lng: number, heading?: number) =>
    api<{ ok: boolean }>('/api/presence/location', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, heading }),
    }),
  groups: () => api<{ groups: Group[] }>('/api/groups'),
  createGroup: (name: string, memberIds: string[]) =>
    api<{ groups: Group[] }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    }),
  addGroupMember: (groupId: string, userId: string) =>
    api<{ groups: Group[] }>(`/api/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  startCall: (groupId: string) =>
    api<{ call: any }>(`/api/groups/${groupId}/call`, { method: 'POST', body: '{}' }),
  joinCall: (groupId: string) =>
    api<{ call: any; sessionId: string; tracks: any[] }>(`/api/groups/${groupId}/call/join`, {
      method: 'POST',
      body: '{}',
    }),
  tracks: (groupId: string, body: unknown) =>
    api<{ result: any; call?: any }>(`/api/groups/${groupId}/call/tracks`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  renegotiate: (groupId: string, body: unknown) =>
    api<{ result: any }>(`/api/groups/${groupId}/call/renegotiate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  endCall: (groupId: string, body: unknown = {}) =>
    api<{ ok: boolean }>(`/api/groups/${groupId}/call/end`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
