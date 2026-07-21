import { friendsApi } from '@/api/friendsApi'

export type RemoteTrackInfo = {
  userId: string
  name: string
  sessionId: string
  trackName: string
}

function createPeerConnection() {
  return new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    bundlePolicy: 'max-bundle',
  })
}

function isMicDenied(err: unknown) {
  if (!err || typeof err !== 'object') return false
  const e = err as DOMException
  const name = e.name || ''
  const msg = String(e.message || '').toLowerCase()
  return (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    name === 'NotFoundError' ||
    name === 'NotReadableError' ||
    msg.includes('permission') ||
    msg.includes('denied')
  )
}

/** Unlock autoplay on locked-down browsers (Tesla) while we still have a user gesture. */
async function unlockAudioPlayback() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (Ctx) {
      const ctx = new Ctx()
      await ctx.resume().catch(() => null)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.05)
      window.setTimeout(() => ctx.close().catch(() => null), 200)
    }
  } catch {
    /* ignore */
  }
}

export class GroupCallClient {
  groupId: string
  sessionId: string | null = null
  pc: RTCPeerConnection | null = null
  localStream: MediaStream | null = null
  localTrackName: string | null = null
  remoteAudio = new Map<string, HTMLAudioElement>()
  muted = false
  /** False when browser/car blocks microphone (common in Tesla). */
  micAvailable = true
  onRemoteChange?: () => void

  constructor(groupId: string) {
    this.groupId = groupId
  }

  async join(existingTracks: RemoteTrackInfo[] = []) {
    const join = await friendsApi.joinCall(this.groupId)
    this.sessionId = join.sessionId
    await unlockAudioPlayback()

    this.pc = createPeerConnection()

    let track: MediaStreamTrack | null = null
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('getUserMedia unavailable', 'NotAllowedError')
      }
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      track = this.localStream.getAudioTracks()[0] || null
    } catch (err) {
      if (!isMicDenied(err)) throw err
      this.micAvailable = false
      this.muted = true
      this.localStream = null
      track = null
    }

    if (track) {
      this.localTrackName = track.id
      const transceiver = this.pc.addTransceiver(track, { direction: 'sendonly' })
      const offer = await this.pc.createOffer()
      await this.pc.setLocalDescription(offer)

      const push = await friendsApi.tracks(this.groupId, {
        sessionId: this.sessionId,
        sessionDescription: { sdp: offer.sdp, type: 'offer' },
        tracks: [
          {
            location: 'local',
            mid: transceiver.mid,
            trackName: track.id,
          },
        ],
        publish: { trackName: track.id },
      })

      await this.pc.setRemoteDescription(
        new RTCSessionDescription(push.result.sessionDescription),
      )
    }

    const others = [...existingTracks, ...(join.tracks || [])].filter(
      (t, i, arr) => arr.findIndex((x) => x.trackName === t.trackName) === i,
    )

    for (const t of others) {
      await this.pullTrack(t)
    }
  }

  async pullTrack(info: RemoteTrackInfo) {
    if (!this.sessionId || !this.pc) return
    if (this.remoteAudio.has(info.trackName)) return

    const pull = await friendsApi.tracks(this.groupId, {
      sessionId: this.sessionId,
      tracks: [
        {
          location: 'remote',
          sessionId: info.sessionId,
          trackName: info.trackName,
        },
      ],
    })

    const result = pull.result
    const mid = result.tracks?.[0]?.mid
    const trackPromise = new Promise<MediaStreamTrack>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Track timeout')), 8000)
      const handler = (ev: RTCTrackEvent) => {
        if (mid && ev.transceiver.mid !== mid) return
        clearTimeout(timer)
        this.pc?.removeEventListener('track', handler)
        resolve(ev.track)
      }
      this.pc?.addEventListener('track', handler)
    })

    if (result.requiresImmediateRenegotiation && result.sessionDescription) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(result.sessionDescription))
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      await friendsApi.renegotiate(this.groupId, {
        sessionId: this.sessionId,
        sessionDescription: { sdp: answer.sdp, type: 'answer' },
      })
    }

    const remoteTrack = await trackPromise
    const audio = new Audio()
    audio.autoplay = true
    audio.setAttribute('playsinline', 'true')
    audio.srcObject = new MediaStream([remoteTrack])
    await audio.play().catch(() => null)
    this.remoteAudio.set(info.trackName, audio)
    this.onRemoteChange?.()
  }

  setMuted(muted: boolean) {
    if (!this.micAvailable) {
      this.muted = true
      return
    }
    this.muted = muted
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted
    })
  }

  toggleMute() {
    if (!this.micAvailable) return true
    this.setMuted(!this.muted)
    return this.muted
  }

  async hangUp() {
    const sessionId = this.sessionId
    const trackName = this.localTrackName
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.remoteAudio.forEach((a) => {
      a.pause()
      a.srcObject = null
    })
    this.remoteAudio.clear()
    this.pc?.close()
    this.pc = null
    this.localStream = null
    if (sessionId) {
      await friendsApi.endCall(this.groupId, { sessionId, trackName }).catch(() => null)
    }
  }
}
