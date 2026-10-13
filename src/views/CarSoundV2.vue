<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, computed, watch } from 'vue'
import { Volume2, ChevronRight } from 'lucide-vue-next'
import { Vehicle } from '../engineV2/Vehicle'
import * as configurations from '../engineV2/configurations'
import type { EngineConfiguration } from '../engineV2/configurations'
import { SHIFT_MODE_LIST, type ShiftMode } from '../engineV2/shiftModes'

const MANUAL_RETURN_MS = 8000

const vehicle = shallowRef<Vehicle | null>(null)
const engineReady = ref(false)
const errorMessage = ref('')

const rpm = ref(1000)
const throttle = ref(0)
const gear = ref(0)
const volume = ref(50)
const speed = ref(0)
const acceleration = ref(0)

type PermissionStatus = 'off' | 'pending' | 'allowed' | 'denied'
const accelerometerStatus = ref<PermissionStatus>('off')
const geolocationStatus = ref<PermissionStatus>('off')

const maxRpm = ref(8000)
const minRpm = ref(1000)
const sensitivity = ref(55)
const selectedConfig = ref<keyof typeof configurations>('bac_mono')
const subwoofer = ref(localStorage.getItem('carSound.subwoofer') !== 'off')
const driving = ref(false)
const shiftMode = ref<ShiftMode>('average')
const autoShiftEnabled = ref(true)

let animationId: number | null = null
let lastTime = 0
let watchId: number | null = null
let manualReturnTimer: ReturnType<typeof setTimeout> | null = null

/* Road speed (m/s) and acceleration (m/s²) estimated from GPS fixes, predicted between them */
const BLIP_MS = 350
let gpsSpeed = 0
let gpsAccel = 0
let gpsFixAt = 0
let roadSpeed = 0
let blipUntil = 0
let revHeld = false

const rpmDisplay = computed(() => Math.round(rpm.value).toLocaleString())
const speedDisplay = computed(() => Math.round(speed.value).toLocaleString())
const gearDisplay = computed(() => (gear.value === 0 ? 'N' : String(gear.value)))
const activeConfig = computed(() => configurations[selectedConfig.value] as EngineConfiguration)
const statusLabel = computed(() => {
  if (errorMessage.value) return 'Error'
  if (!engineReady.value) return 'Starting…'
  if (driving.value) return autoShiftEnabled.value ? 'Driving · Auto' : 'Driving · Manual'
  return 'Ready · stopped'
})

/* Tachometer: 270° sweep, one label per 1,000 rpm, red zone from the soft limiter */
const TACH_R = 170
const TACH_START = 135
const TACH_SWEEP = 270
const tachMax = computed(() => Math.ceil(maxRpm.value / 1000) * 1000)
const tachPoint = (value: number, r: number) => {
  const a = ((TACH_START + (TACH_SWEEP * value) / tachMax.value) * Math.PI) / 180
  return { x: 200 + r * Math.cos(a), y: 200 + r * Math.sin(a) }
}
const tachArc = (from: number, to: number, r = TACH_R) => {
  const a = tachPoint(from, r)
  const b = tachPoint(to, r)
  const large = ((to - from) / tachMax.value) * TACH_SWEEP > 180 ? 1 : 0
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`
}
const redline = computed(() => maxRpm.value * 0.97)
const tachTicks = computed(() => {
  const ticks = []
  for (let v = 0; v <= tachMax.value; v += 500) {
    const major = v % 1000 === 0
    const outer = tachPoint(v, TACH_R - 18)
    const inner = tachPoint(v, TACH_R - (major ? 34 : 26))
    const label = tachPoint(v, TACH_R - 62)
    ticks.push({ v, major, outer, inner, label, red: v >= redline.value })
  }
  return ticks
})
const rpmPercent = computed(() => Math.min(100, Math.max(0, (rpm.value / tachMax.value) * 100)))

const permissionLabel = (status: PermissionStatus) => {
  switch (status) {
    case 'allowed':
      return 'Allowed'
    case 'pending':
      return 'Requesting…'
    case 'denied':
      return 'Blocked / denied'
    default:
      return 'Off'
  }
}

const disposeVehicle = () => {
  if (!vehicle.value) return
  vehicle.value.dispose()
  vehicle.value = null
}

const syncAutoShift = () => {
  if (!vehicle.value) return
  vehicle.value.autoShiftEnabled = autoShiftEnabled.value
  vehicle.value.setShiftMode(shiftMode.value)
}

const clearManualReturnTimer = () => {
  if (manualReturnTimer) {
    clearTimeout(manualReturnTimer)
    manualReturnTimer = null
  }
}

const scheduleAutoReturn = () => {
  clearManualReturnTimer()
  manualReturnTimer = setTimeout(() => {
    autoShiftEnabled.value = true
    syncAutoShift()
    manualReturnTimer = null
  }, MANUAL_RETURN_MS)
}

const enterManualMode = () => {
  autoShiftEnabled.value = false
  syncAutoShift()
  scheduleAutoReturn()
}

const setSubwoofer = (present: boolean) => {
  subwoofer.value = present
  handleSubwooferChange()
}

/* Stopped, the steering wheel button blips the throttle; moving, it shifts */
const blip = () => {
  blipUntil = performance.now() + BLIP_MS
}

const shiftUpManual = () => {
  if (!vehicle.value || !engineReady.value) return
  if (!vehicle.value.driving) return blip()
  enterManualMode()
  vehicle.value.nextGear()
}

const shiftDownManual = () => {
  if (!vehicle.value || !engineReady.value) return
  if (!vehicle.value.driving) return blip()
  enterManualMode()
  vehicle.value.prevGear()
}

const startRev = () => {
  revHeld = true
  void resumeAudioIfNeeded()
}

const stopRev = () => {
  revHeld = false
}

const handleSubwooferChange = () => {
  localStorage.setItem('carSound.subwoofer', subwoofer.value ? 'on' : 'off')
  vehicle.value?.audio.setSubwoofer(subwoofer.value)
}

const selectShiftMode = (mode: ShiftMode) => {
  shiftMode.value = mode
  syncAutoShift()
}

const updateVolume = () => {
  vehicle.value?.audio.setMasterVolume(volume.value / 100)
}

const handleVolumeChange = (e: Event) => {
  volume.value = parseInt((e.target as HTMLInputElement).value)
  updateVolume()
}

const stopAccelerometer = () => {
  window.removeEventListener('devicemotion', handleMotion)
}

const stopGeolocation = () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
}

const handleMotion = (event: DeviceMotionEvent) => {
  if (!event.acceleration) return
  acceleration.value = event.acceleration.y || 0
}

/* Longitudinal acceleration: GPS, sharpened by the accelerometer when it reports something */
const currentAccel = () => {
  const sensor = accelerometerStatus.value === 'allowed' ? acceleration.value : 0
  const accel = Math.abs(sensor) > 0.2 ? (gpsAccel + sensor) / 2 : gpsAccel
  return accel * (sensitivity.value / 55)
}

/* Speed between fixes: extrapolate the last fix for half a second at most */
const currentSpeed = (now: number, dt: number) => {
  const since = gpsFixAt ? Math.min((now - gpsFixAt) / 1000, 0.5) : 0
  const predicted = Math.max(0, gpsSpeed + gpsAccel * since)
  roadSpeed += (predicted - roadSpeed) * (1 - Math.exp(-dt / 0.15))
  return roadSpeed
}

const startWatchingPosition = () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }

  let lastPosition: GeolocationPosition | null = null
  let lastStamp = 0

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = performance.now()
      let kmh = speed.value
      if (lastPosition && lastStamp) {
        const distance = calculateDistance(
          lastPosition.coords.latitude,
          lastPosition.coords.longitude,
          position.coords.latitude,
          position.coords.longitude,
        )
        const timeDiff = (now - lastStamp) / 3600000
        if (timeDiff > 0) kmh = distance / timeDiff
      }
      // Prefer native speed when available (m/s -> km/h)
      if (typeof position.coords.speed === 'number' && !Number.isNaN(position.coords.speed) && position.coords.speed >= 0) {
        kmh = position.coords.speed * 3.6
      }

      /* Acceleration from successive fixes, smoothed: GPS speed is noisy at 1-10 Hz */
      const next = kmh / 3.6
      const fixDt = gpsFixAt ? (now - gpsFixAt) / 1000 : 0
      if (fixDt > 0.05 && fixDt < 3) {
        const raw = Math.max(-12, Math.min(12, (next - gpsSpeed) / fixDt))
        gpsAccel += (raw - gpsAccel) * Math.min(1, fixDt / 0.35)
      } else {
        gpsAccel = 0
      }
      gpsSpeed = next
      gpsFixAt = now
      speed.value = kmh

      lastPosition = position
      lastStamp = now
    },
    (error) => {
      console.error('Geolocation watching error:', error)
      geolocationStatus.value = 'denied'
    },
    { enableHighAccuracy: true, maximumAge: 0 },
  )
}

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const requestAccelerometer = async () => {
  if (!('DeviceMotionEvent' in window)) {
    accelerometerStatus.value = 'denied'
    return
  }
  accelerometerStatus.value = 'pending'
  try {
    const requestPermission = (DeviceMotionEvent as any).requestPermission as
      | undefined
      | (() => Promise<string>)
    if (typeof requestPermission === 'function') {
      const state = await requestPermission()
      if (state !== 'granted') {
        accelerometerStatus.value = 'denied'
        return
      }
    }
    window.removeEventListener('devicemotion', handleMotion)
    window.addEventListener('devicemotion', handleMotion)
    accelerometerStatus.value = 'allowed'
  } catch (error) {
    console.error('Accelerometer error:', error)
    accelerometerStatus.value = 'denied'
  }
}

const requestGeolocation = () => {
  if (!('geolocation' in navigator)) {
    geolocationStatus.value = 'denied'
    return
  }
  geolocationStatus.value = 'pending'
  navigator.geolocation.getCurrentPosition(
    () => {
      geolocationStatus.value = 'allowed'
      startWatchingPosition()
    },
    (error) => {
      console.error('Geolocation error:', error)
      geolocationStatus.value = 'denied'
      stopGeolocation()
    },
    { enableHighAccuracy: true, timeout: 10000 },
  )
}

const startSensors = () => {
  void requestAccelerometer()
  requestGeolocation()
}

const bindMediaKeys = () => {
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Car Sound',
        artist: 'tslap.store',
        album: 'Engine',
      })
      navigator.mediaSession.playbackState = 'playing'
      navigator.mediaSession.setActionHandler('nexttrack', () => shiftUpManual())
      navigator.mediaSession.setActionHandler('previoustrack', () => shiftDownManual())
    } catch (error) {
      console.warn('Media session unavailable', error)
    }
  }
  window.addEventListener('keydown', handleMediaKeyDown)
}

const unbindMediaKeys = () => {
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'paused'
      navigator.mediaSession.setActionHandler('nexttrack', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
    } catch {
      /* ignore */
    }
  }
  window.removeEventListener('keydown', handleMediaKeyDown)
}

const handleMediaKeyDown = (e: KeyboardEvent) => {
  if (e.code === 'MediaTrackNext' || e.key === 'MediaTrackNext') {
    e.preventDefault()
    shiftUpManual()
  } else if (e.code === 'MediaTrackPrevious' || e.key === 'MediaTrackPrevious') {
    e.preventDefault()
    shiftDownManual()
  }
}

/* Parked: throttle only from blips and the rev button */
const updateParkedThrottle = (now: number) => {
  if (!vehicle.value || vehicle.value.driving) return
  const target = revHeld || now < blipUntil ? 1 : 0
  const current = vehicle.value.engine.throttle
  vehicle.value.engine.throttle = current + (target - current) * (target > current ? 0.5 : 0.25)
}

const startUpdateLoop = () => {
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }

  const update = (time: number) => {
    if (!engineReady.value || !vehicle.value) {
      animationId = null
      return
    }

    const dt = lastTime ? (time - lastTime) / 1000 : 0.016
    lastTime = time

    if (dt > 0) {
      const step = Math.min(dt, 0.033)
      updateParkedThrottle(time)
      vehicle.value.update(time, step, currentSpeed(time, step), currentAccel())
      rpm.value = vehicle.value.engine.rpm
      throttle.value = vehicle.value.load
      gear.value = vehicle.value.drivetrain.gear
      driving.value = vehicle.value.driving
    }

    animationId = requestAnimationFrame(update)
  }

  animationId = requestAnimationFrame(update)
}

const initVehicle = async () => {
  try {
    disposeVehicle()
    const next = new Vehicle()
    const config = configurations[selectedConfig.value] as EngineConfiguration
    await next.init(config)
    vehicle.value = next
    maxRpm.value = config.engine.limiter || 8000
    minRpm.value = config.engine.idle || 1000
    rpm.value = next.engine.rpm
    updateVolume()
    next.audio.setSubwoofer(subwoofer.value)
    syncAutoShift()
  } catch (error) {
    console.error('Failed to initialize vehicle:', error)
    disposeVehicle()
    throw error
  }
}

const teardownEngine = () => {
  engineReady.value = false
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
  lastTime = 0
  revHeld = false
  blipUntil = 0
  gpsSpeed = 0
  gpsAccel = 0
  gpsFixAt = 0
  roadSpeed = 0
  clearManualReturnTimer()
  unbindMediaKeys()
  stopAccelerometer()
  stopGeolocation()
  disposeVehicle()
}

const resumeAudioIfNeeded = async () => {
  const ctx = vehicle.value?.audio.ctx
  if (ctx && ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch (error) {
      console.warn('Audio resume failed', error)
    }
  }
}

const bootEngine = async () => {
  try {
    errorMessage.value = ''
    await initVehicle()
    if (!vehicle.value) {
      errorMessage.value = 'Failed to start engine.'
      return
    }

    void resumeAudioIfNeeded()
    updateVolume()
    autoShiftEnabled.value = true
    syncAutoShift()
    startSensors()
    bindMediaKeys()
    engineReady.value = true
    startUpdateLoop()

    // Browsers may keep AudioContext suspended until a gesture — unlock on first tap
    const unlock = () => {
      void resumeAudioIfNeeded()
      window.removeEventListener('pointerdown', unlock)
    }
    window.addEventListener('pointerdown', unlock, { once: true })
  } catch (error) {
    console.error(error)
    errorMessage.value = error instanceof Error ? error.message : 'Failed to start engine'
    teardownEngine()
  }
}

const handleConfigChange = async (e: Event) => {
  selectedConfig.value = (e.target as HTMLSelectElement).value as keyof typeof configurations
  teardownEngine()
  await bootEngine()
}

onMounted(() => {
  void bootEngine()
})

onUnmounted(() => {
  teardownEngine()
})

watch(shiftMode, () => syncAutoShift())
</script>

<template>
  <div class="car-sound">
    <header class="topbar">
      <button class="icon-button" aria-label="Back" @click="$router.go(-1)">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <span class="wordmark">CAR SOUND</span>
      <span class="status" :class="{ live: engineReady && !errorMessage, error: !!errorMessage }">
        <span class="status-dot"></span>{{ statusLabel }}
      </span>
    </header>

    <main class="layout">
      <section class="tach-wrap">
        <svg class="tach" viewBox="0 0 400 400" role="img" :aria-label="`${rpmDisplay} rpm, gear ${gearDisplay}, ${speedDisplay} km/h`">
          <path class="tach-track" :d="tachArc(0, tachMax)" />
          <path class="tach-red" :d="tachArc(redline, tachMax)" />
          <path
            class="tach-fill"
            :class="{ hot: rpm >= redline }"
            :d="tachArc(0, tachMax)"
            pathLength="100"
            stroke-dasharray="100 100"
            :stroke-dashoffset="100 - rpmPercent"
          />
          <g v-for="tick in tachTicks" :key="tick.v">
            <line
              class="tach-tick"
              :class="{ major: tick.major, red: tick.red }"
              :x1="tick.inner.x" :y1="tick.inner.y" :x2="tick.outer.x" :y2="tick.outer.y"
            />
            <text
              v-if="tick.major"
              class="tach-label"
              :class="{ red: tick.red }"
              :x="tick.label.x" :y="tick.label.y"
              text-anchor="middle" dominant-baseline="central"
            >{{ tick.v / 1000 }}</text>
          </g>

          <text class="tach-gear" x="200" y="172" text-anchor="middle" dominant-baseline="central">{{ gearDisplay }}</text>
          <text class="tach-caption" x="200" y="246" text-anchor="middle">Gear</text>
          <rect class="load-track" x="140" y="260" width="120" height="6" rx="3" />
          <rect class="load-fill" x="140" y="260" :width="120 * throttle" height="6" rx="3" />
          <text class="tach-caption" x="200" y="286" text-anchor="middle">Load</text>

          <text class="tach-speed" x="200" y="332" text-anchor="middle" dominant-baseline="central">{{ speedDisplay }}</text>
          <text class="tach-caption" x="200" y="370" text-anchor="middle">km/h · {{ rpmDisplay }} rpm</text>
        </svg>
      </section>

      <aside class="panel">
        <label class="car-card">
          <span class="car-text">
            <span class="car-name">{{ activeConfig.label }}</span>
            <span class="car-sub">{{ activeConfig.subtitle }}</span>
          </span>
          <ChevronRight class="car-chevron" />
          <select v-model="selectedConfig" class="car-select" aria-label="Engine" @change="handleConfigChange">
            <option v-for="(config, key) in configurations" :key="key" :value="key">{{ config.label }}</option>
          </select>
        </label>

        <div class="row">
          <span class="row-label">Shifting</span>
          <div class="segmented">
            <button
              v-for="mode in SHIFT_MODE_LIST"
              :key="mode.id"
              :class="{ active: shiftMode === mode.id }"
              @click="selectShiftMode(mode.id)"
            >{{ mode.label }}</button>
          </div>
        </div>

        <div class="row">
          <span class="row-label">Speakers</span>
          <div class="segmented">
            <button :class="{ active: subwoofer }" @click="setSubwoofer(true)">Subwoofer</button>
            <button :class="{ active: !subwoofer }" @click="setSubwoofer(false)">Doors only</button>
          </div>
        </div>

        <div class="row">
          <span class="row-label"><Volume2 class="row-icon" /> Volume</span>
          <input type="range" min="0" max="100" :value="volume" class="slider" aria-label="Volume" @input="handleVolumeChange" />
        </div>

        <div class="row">
          <span class="row-label">Response</span>
          <input type="range" min="0" max="100" v-model.number="sensitivity" class="slider" aria-label="Acceleration sensitivity" />
        </div>

        <div class="sensors">
          <span :class="geolocationStatus">GPS · {{ permissionLabel(geolocationStatus) }}</span>
          <span :class="accelerometerStatus">Motion · {{ permissionLabel(accelerometerStatus) }}</span>
        </div>

        <p v-if="errorMessage" class="hint error-text">{{ errorMessage }}</p>
        <p v-else class="hint">
          <template v-if="driving">RPM follows your speed through the gearbox, load follows acceleration. Steering wheel next/prev shifts.</template>
          <template v-else>Stopped: steering wheel next/prev blips the throttle. Drive off and the engine follows the car.</template>
        </p>

        <div class="actions">
          <template v-if="driving">
            <button class="action secondary" @click="shiftDownManual">Gear −</button>
            <button class="action secondary" @click="shiftUpManual">Gear +</button>
          </template>
          <button
            v-else
            class="action"
            :disabled="!engineReady"
            @pointerdown.prevent="startRev"
            @pointerup="stopRev"
            @pointerleave="stopRev"
            @pointercancel="stopRev"
          >
            {{ engineReady ? 'Hold to rev' : 'Starting…' }}
          </button>
        </div>
      </aside>
    </main>
  </div>
</template>

<style scoped>
/* Night by default (the rest of the app is dark), day when the car says it's day */
.car-sound {
  --bg: #0c0c0d;
  --fg: #f4f4f5;
  --muted: #8b8b90;
  --line: #232326;
  --track: #2a2a2e;
  --panel: #19191b;
  --seg-active: #34343a;
  --action-bg: #f4f4f5;
  --action-fg: #0c0c0d;
  --red: #e5252b;
  --accent: #c8a15a;

  min-height: 100vh;
  background: var(--bg);
  color: var(--fg);
  font-family: Montserrat, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  display: flex;
  flex-direction: column;
  -webkit-tap-highlight-color: transparent;
}

@media (prefers-color-scheme: light) {
  .car-sound {
    --bg: #f4f4f4;
    --fg: #111112;
    --muted: #8a8a8e;
    --line: #e2e2e2;
    --track: #e0e0e0;
    --panel: #e9e9ea;
    --seg-active: #ffffff;
    --action-bg: #111112;
    --action-fg: #ffffff;
  }
}

.topbar {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 0.9rem 1.25rem;
  border-bottom: 1px solid var(--line);
}

.icon-button {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  color: var(--fg);
}

.icon-button:active {
  background: var(--panel);
}

.wordmark {
  white-space: nowrap;
  font-weight: 500;
  letter-spacing: 0.45em;
  font-size: 0.95rem;
}

.status {
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--muted);
  font-size: 0.85rem;
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--muted);
}

.status.live .status-dot {
  background: var(--accent);
}

.status.error .status-dot {
  background: var(--red);
}

.layout {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
  gap: 2rem;
  padding: 1.25rem 1.5rem 1.5rem;
}

.tach-wrap {
  display: grid;
  place-items: center;
  min-height: 0;
}

.tach {
  width: min(100%, 72vh);
  height: auto;
  font-family: inherit;
  user-select: none;
}

.tach-track,
.tach-fill,
.tach-red {
  fill: none;
  stroke-linecap: round;
}

.tach-track {
  stroke: var(--track);
  stroke-width: 12;
}

.tach-red {
  stroke: var(--red);
  stroke-width: 12;
  opacity: 0.3;
}

.tach-fill {
  stroke: var(--fg);
  stroke-width: 12;
}

.tach-fill.hot {
  stroke: var(--red);
}

.tach-tick {
  stroke: var(--muted);
  stroke-width: 1.5;
  stroke-linecap: round;
  opacity: 0.6;
}

.tach-tick.major {
  stroke-width: 2.5;
  opacity: 1;
}

.tach-tick.red,
.tach-label.red {
  stroke: var(--red);
  fill: var(--red);
}

.tach-label {
  fill: var(--muted);
  font-size: 26px;
  font-weight: 500;
}

.tach-gear {
  fill: var(--fg);
  font-size: 118px;
  font-weight: 700;
}

.tach-caption {
  fill: var(--muted);
  font-size: 15px;
  font-weight: 500;
}

.load-track {
  fill: var(--track);
}

.load-fill {
  fill: var(--fg);
}

.tach-speed {
  fill: var(--fg);
  font-size: 58px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.car-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-radius: 14px;
  background: var(--panel);
  cursor: pointer;
}

.car-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}

.car-name {
  font-size: 1.1rem;
  font-weight: 600;
}

.car-sub {
  color: var(--muted);
  font-size: 0.85rem;
}

.car-chevron {
  width: 1.2rem;
  height: 1.2rem;
  color: var(--muted);
}

/* Native picker over the whole card: big target, system list in the car */
.car-select {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.row {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
  min-height: 3rem;
}

.row-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--muted);
  font-size: 0.85rem;
}

.row-icon {
  width: 1rem;
  height: 1rem;
}

.segmented {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: 12px;
  background: var(--panel);
}

.segmented button {
  flex: 1;
  padding: 0.65rem 0.4rem;
  border-radius: 9px;
  color: var(--muted);
  font-size: 0.9rem;
  font-weight: 500;
  transition: background 0.15s ease, color 0.15s ease;
}

.segmented button.active {
  background: var(--seg-active);
  color: var(--fg);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.slider {
  width: 100%;
  height: 2.75rem;
  accent-color: var(--fg);
}

.sensors {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: var(--muted);
}

.sensors .allowed::before,
.sensors .denied::before,
.sensors .pending::before,
.sensors .off::before {
  content: '';
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  margin-right: 0.4rem;
  border-radius: 999px;
  background: var(--muted);
}

.sensors .allowed::before {
  background: #34c759;
}

.sensors .denied::before {
  background: var(--red);
}

.sensors .pending::before {
  background: var(--accent);
}

.hint {
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.error-text {
  color: var(--red);
}

.actions {
  display: flex;
  gap: 0.6rem;
  margin-top: auto;
  padding-top: 1rem;
}

.action {
  flex: 1;
  padding: 1.15rem;
  border-radius: 12px;
  background: var(--action-bg);
  color: var(--action-fg);
  font-size: 1.1rem;
  font-weight: 600;
  touch-action: none;
  user-select: none;
  transition: transform 0.1s ease, opacity 0.15s ease;
}

.action:active {
  transform: scale(0.98);
}

.action:disabled {
  opacity: 0.5;
}

.action.secondary {
  background: var(--panel);
  color: var(--fg);
}

@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
    gap: 1rem;
    padding: 1rem;
  }

  .tach {
    width: min(100%, 420px);
  }

  .status {
    margin-left: auto;
  }

  .wordmark {
    letter-spacing: 0.3em;
  }
}

@media (min-width: 861px) {
  .status {
    margin-left: 0;
  }
}
</style>
