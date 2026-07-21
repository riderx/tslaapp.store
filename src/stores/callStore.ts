import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { friendsApi } from '@/api/friendsApi'
import { GroupCallClient, type RemoteTrackInfo } from '@/lib/sfuClient'

export type CallPhase = 'idle' | 'ringing' | 'connecting' | 'in_call'

export const useCallStore = defineStore('call', () => {
  const phase = ref<CallPhase>('idle')
  const groupId = ref<string | null>(null)
  const groupName = ref('')
  const fromName = ref('')
  const muted = ref(false)
  const error = ref<string | null>(null)
  const remoteCount = ref(0)
  let client: GroupCallClient | null = null
  let ringAudio: HTMLAudioElement | null = null

  const isActive = computed(() => phase.value !== 'idle')
  const playLabel = computed(() => {
    if (phase.value === 'ringing') return 'Answer Call'
    if (phase.value === 'connecting') return 'Connecting…'
    if (phase.value === 'in_call') return muted.value ? 'Unmute Mic' : 'Mute Mic'
    return 'Start'
  })

  function bindSocket() {
    window.addEventListener('friends-socket', onSocket as EventListener)
  }

  function onSocket(ev: Event) {
    const msg = (ev as CustomEvent).detail
    if (msg.type === 'ring') {
      if (phase.value === 'in_call' || phase.value === 'connecting') return
      groupId.value = msg.groupId
      groupName.value = msg.groupName || 'Group'
      fromName.value = msg.from?.name || 'Friend'
      phase.value = 'ringing'
      startRingTone()
    }
    if (msg.type === 'track_published' && phase.value === 'in_call' && client) {
      const track = msg.track as RemoteTrackInfo
      client.pullTrack(track).catch(() => null)
    }
    if (msg.type === 'call_ended' && msg.groupId === groupId.value) {
      forceReset()
    }
  }

  function startRingTone() {
    stopRingTone()
    // Simple oscillator ring via Web Audio — no asset needed
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.05
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      const pulse = window.setInterval(() => {
        gain.gain.value = gain.gain.value > 0 ? 0 : 0.05
      }, 400)
      ringAudio = { pause: () => { clearInterval(pulse); osc.stop(); ctx.close() } } as any
    } catch {
      /* ignore */
    }
  }

  function stopRingTone() {
    try {
      ringAudio?.pause()
    } catch {
      /* ignore */
    }
    ringAudio = null
  }

  async function startGroupCall(id: string, name: string) {
    error.value = null
    groupId.value = id
    groupName.value = name
    fromName.value = 'You'
    phase.value = 'connecting'
    try {
      await friendsApi.startCall(id)
      await answerCall()
    } catch (e) {
      phase.value = 'idle'
      error.value = e instanceof Error ? e.message : 'Call failed'
    }
  }

  async function answerCall() {
    if (!groupId.value) return
    error.value = null
    stopRingTone()
    phase.value = 'connecting'
    try {
      client = new GroupCallClient(groupId.value)
      client.onRemoteChange = () => {
        remoteCount.value = client?.remoteAudio.size || 0
      }
      await client.join()
      muted.value = false
      phase.value = 'in_call'
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not join call'
      await hangUp()
    }
  }

  function toggleMute() {
    if (phase.value !== 'in_call' || !client) return
    muted.value = client.toggleMute()
  }

  async function hangUp() {
    stopRingTone()
    const id = groupId.value
    const c = client
    client = null
    if (c) await c.hangUp().catch(() => null)
    else if (id) await friendsApi.endCall(id).catch(() => null)
    forceReset()
  }

  function forceReset() {
    stopRingTone()
    phase.value = 'idle'
    groupId.value = null
    groupName.value = ''
    fromName.value = ''
    muted.value = false
    remoteCount.value = 0
    client = null
  }

  /** Play button: answer / mute toggle. Long-press handled by UI → hangUp */
  async function onPlayClick() {
    if (phase.value === 'ringing') return answerCall()
    if (phase.value === 'in_call') return toggleMute()
  }

  bindSocket()

  return {
    phase,
    groupId,
    groupName,
    fromName,
    muted,
    error,
    remoteCount,
    isActive,
    playLabel,
    startGroupCall,
    answerCall,
    toggleMute,
    hangUp,
    onPlayClick,
  }
})
