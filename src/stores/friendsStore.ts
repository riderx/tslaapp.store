import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  clearToken,
  friendsApi,
  getToken,
  setToken,
  type Friend,
  type FriendLocation,
  type Group,
  type User,
} from '@/api/friendsApi'

export const useFriendsStore = defineStore('friends', () => {
  const user = ref<User | null>(null)
  const friends = ref<Friend[]>([])
  const groups = ref<Group[]>([])
  const locations = ref<Record<string, FriendLocation>>({})
  const sfuReady = ref(false)
  const connected = ref(false)
  const error = ref<string | null>(null)
  const sharingLocation = ref(false)
  let ws: WebSocket | null = null
  let watchId: number | null = null
  let pingTimer: number | null = null

  const acceptedFriends = computed(() => friends.value.filter((f) => f.status === 'accepted'))
  const pendingIncoming = computed(() =>
    friends.value.filter((f) => f.status === 'pending' && f.direction === 'incoming'),
  )

  async function bootstrap() {
    error.value = null
    if (!getToken()) return
    try {
      const me = await friendsApi.me()
      user.value = me.user
      sfuReady.value = me.sfu
      await refresh()
      connectSocket()
    } catch {
      clearToken()
      user.value = null
    }
  }

  async function register(name: string) {
    const res = await friendsApi.register(name)
    setToken(res.token)
    user.value = res.user
    await bootstrap()
  }

  async function refresh() {
    const [f, g] = await Promise.all([friendsApi.friends(), friendsApi.groups()])
    friends.value = f.friends
    groups.value = g.groups
    const locs = await friendsApi.locations().catch(() => ({ locations: [] as FriendLocation[] }))
    const map: Record<string, FriendLocation> = {}
    for (const loc of locs.locations) map[loc.userId] = loc
    locations.value = map
  }

  async function addFriend(code: string) {
    const res = await friendsApi.requestFriend(code)
    friends.value = res.friends
    return res.message
  }

  async function acceptFriend(userId: string) {
    const res = await friendsApi.acceptFriend(userId)
    friends.value = res.friends
  }

  async function createGroup(name: string, memberIds: string[]) {
    const res = await friendsApi.createGroup(name, memberIds)
    groups.value = res.groups
  }

  function connectSocket() {
    const token = getToken()
    if (!token || ws) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
    ws.onopen = () => {
      connected.value = true
      pingTimer = window.setInterval(() => {
        ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' }))
      }, 25000)
    }
    ws.onclose = () => {
      connected.value = false
      ws = null
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = null
      setTimeout(connectSocket, 2000)
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        handleSocketMessage(msg)
      } catch {
        /* ignore */
      }
    }
  }

  function handleSocketMessage(msg: any) {
    if (msg.type === 'friend_location' && msg.userId) {
      locations.value = {
        ...locations.value,
        [msg.userId]: {
          userId: msg.userId,
          name: msg.name,
          location: {
            lat: msg.lat,
            lng: msg.lng,
            heading: msg.heading,
            updatedAt: msg.updatedAt || Date.now(),
          },
        },
      }
    }
    if (msg.type === 'friend_request' || msg.type === 'friend_accepted') {
      refresh().catch(() => null)
    }
    window.dispatchEvent(new CustomEvent('friends-socket', { detail: msg }))
  }

  async function startSharingLocation() {
    if (!navigator.geolocation) throw new Error('Geolocation unavailable')
    sharingLocation.value = true
    watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, heading } = pos.coords
        try {
          await friendsApi.shareLocation(
            latitude,
            longitude,
            typeof heading === 'number' && !Number.isNaN(heading) ? heading : undefined,
          )
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'location',
                lat: latitude,
                lng: longitude,
                heading,
              }),
            )
          }
        } catch {
          /* ignore transient */
        }
      },
      () => {
        sharingLocation.value = false
      },
      { enableHighAccuracy: true, maximumAge: 2000 },
    )
  }

  function stopSharingLocation() {
    sharingLocation.value = false
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
  }

  function logout() {
    stopSharingLocation()
    ws?.close()
    ws = null
    clearToken()
    user.value = null
    friends.value = []
    groups.value = []
    locations.value = {}
  }

  return {
    user,
    friends,
    groups,
    locations,
    sfuReady,
    connected,
    error,
    sharingLocation,
    acceptedFriends,
    pendingIncoming,
    bootstrap,
    register,
    refresh,
    addFriend,
    acceptFriend,
    createGroup,
    startSharingLocation,
    stopSharingLocation,
    logout,
  }
})
