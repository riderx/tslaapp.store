export interface Env {
  DB: D1Database
  PRESENCE: DurableObjectNamespace
  CALL_ROOM: DurableObjectNamespace
  ASSETS: Fetcher
  CALLS_APP_ID: string
  CALLS_APP_SECRET: string
}

export type UserRow = {
  id: string
  name: string
  friend_code: string
  token_hash: string
  created_at: number
}

export type FriendView = {
  id: string
  name: string
  friendCode: string
  status: 'pending' | 'accepted'
  direction: 'outgoing' | 'incoming' | 'mutual'
}

export type GroupView = {
  id: string
  name: string
  ownerId: string
  members: { id: string; name: string; friendCode: string }[]
}

export type PublishedTrack = {
  userId: string
  name: string
  sessionId: string
  trackName: string
}
