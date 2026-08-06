import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { friendsApi } from '@/api/friendsApi'
import { useFriendsStore } from '@/stores/friendsStore'

export type FriendAlert =
  | {
      id: string
      kind: 'friend_request'
      title: string
      body: string
      fromId: string
      fromName: string
    }
  | {
      id: string
      kind: 'friend_accepted'
      title: string
      body: string
      friendId: string
      friendName: string
    }

export const useNotifyStore = defineStore('notify', () => {
  const queue = ref<FriendAlert[]>([])
  const busy = ref(false)
  let tone: { pause: () => void } | null = null

  const current = computed(() => queue.value[0] || null)

  function bindSocket() {
    window.addEventListener('friends-socket', onSocket as EventListener)
  }

  function onSocket(ev: Event) {
    const msg = (ev as CustomEvent).detail
    if (msg.type === 'friend_request' && msg.from?.id) {
      push({
        id: `req-${msg.from.id}-${Date.now()}`,
        kind: 'friend_request',
        title: 'Friend request',
        body: `${msg.from.name} added you`,
        fromId: msg.from.id,
        fromName: msg.from.name,
      })
      useFriendsStore().refresh().catch(() => null)
    }
    if (msg.type === 'friend_accepted' && msg.friend?.id) {
      push({
        id: `acc-${msg.friend.id}-${Date.now()}`,
        kind: 'friend_accepted',
        title: 'Friend accepted',
        body: `${msg.friend.name} accepted — you are friends`,
        friendId: msg.friend.id,
        friendName: msg.friend.name,
      })
      useFriendsStore().refresh().catch(() => null)
    }
  }

  function push(alert: FriendAlert) {
    if (
      queue.value.some(
        (a) =>
          (a.kind === 'friend_request' &&
            alert.kind === 'friend_request' &&
            a.fromId === alert.fromId) ||
          (a.kind === 'friend_accepted' &&
            alert.kind === 'friend_accepted' &&
            a.friendId === alert.friendId),
      )
    ) {
      return
    }
    queue.value = [...queue.value, alert]
    if (queue.value.length === 1) startTone()
  }

  function dismiss() {
    queue.value = queue.value.slice(1)
    stopTone()
    if (queue.value.length) startTone()
  }

  async function acceptCurrent() {
    const alert = current.value
    if (!alert || alert.kind !== 'friend_request' || busy.value) return
    busy.value = true
    try {
      await friendsApi.acceptFriend(alert.fromId)
      await useFriendsStore().refresh()
      dismiss()
    } finally {
      busy.value = false
    }
  }

  function startTone() {
    stopTone()
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 660
      gain.gain.value = 0.04
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      const pulse = window.setInterval(() => {
        gain.gain.value = gain.gain.value > 0 ? 0 : 0.04
      }, 500)
      tone = {
        pause: () => {
          clearInterval(pulse)
          osc.stop()
          ctx.close()
        },
      }
      window.setTimeout(() => stopTone(), 4000)
    } catch {
      /* ignore */
    }
  }

  function stopTone() {
    try {
      tone?.pause()
    } catch {
      /* ignore */
    }
    tone = null
  }

  bindSocket()

  return {
    queue,
    current,
    busy,
    dismiss,
    acceptCurrent,
  }
})
