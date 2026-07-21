<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, computed, watch } from 'vue'
import { Volume2, Settings, X } from 'lucide-vue-next'
import { Vehicle } from '../engineV2/Vehicle'
import * as configurations from '../engineV2/configurations'
import type { EngineConfiguration } from '../engineV2/configurations'
import { SHIFT_MODE_LIST, type ShiftMode } from '../engineV2/shiftModes'

const MANUAL_RETURN_MS = 8000

const vehicle = shallowRef<Vehicle | null>(null)
const engineReady = ref(false)
const showSettings = ref(false)
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
const shiftMode = ref<ShiftMode>('average')
const autoShiftEnabled = ref(true)

let animationId: number | null = null
let lastTime = 0
let watchId: number | null = null
let manualReturnTimer: ReturnType<typeof setTimeout> | null = null

const shiftModeLabel = computed(() => autoShiftEnabled.value ? 'Auto' : 'Manual')
const rpmDisplay = computed(() => Math.round(rpm.value).toLocaleString())
const speedDisplay = computed(() => Math.round(speed.value).toLocaleString())
const throttleDisplay = computed(() => Math.round(throttle.value * 100))
const gearDisplay = computed(() => (gear.value === 0 ? 'N' : String(gear.value)))

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

const shiftUpManual = () => {
  if (!vehicle.value || !engineReady.value) return
  enterManualMode()
  vehicle.value.nextGear()
}

const shiftDownManual = () => {
  if (!vehicle.value || !engineReady.value) return
  enterManualMode()
  vehicle.value.prevGear()
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

const startWatchingPosition = () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }

  let lastPosition: GeolocationPosition | null = null
  let lastStamp = 0

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now()
      if (lastPosition && lastStamp) {
        const distance = calculateDistance(
          lastPosition.coords.latitude,
          lastPosition.coords.longitude,
          position.coords.latitude,
          position.coords.longitude,
        )
        const timeDiff = (now - lastStamp) / 3600000
        if (timeDiff > 0) speed.value = distance / timeDiff
      }
      // Prefer native speed when available (m/s -> km/h)
      if (typeof position.coords.speed === 'number' && !Number.isNaN(position.coords.speed) && position.coords.speed >= 0) {
        speed.value = position.coords.speed * 3.6
      }
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

const updateThrottle = () => {
  if (!vehicle.value) return

  let newThrottle = 0

  if (geolocationStatus.value === 'allowed') {
    // Map ~0-120 km/h to throttle for EV movement sound
    newThrottle = Math.max(newThrottle, Math.min(speed.value / 120, 1) * 0.85)
  }

  if (accelerometerStatus.value === 'allowed') {
    const forward = Math.max(acceleration.value, 0)
    const accelFactor = Math.min(forward / 3.5, 1)
    if (accelFactor > 0.04) {
      newThrottle = Math.max(newThrottle, accelFactor * (sensitivity.value / 100))
    }
  }

  const target = Math.min(Math.max(newThrottle, 0), 1)
  const current = vehicle.value.engine.throttle
  vehicle.value.engine.throttle = current + (target - current) * 0.18
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
      updateThrottle()
      vehicle.value.update(time, Math.min(dt, 0.033))
      rpm.value = vehicle.value.engine.rpm
      throttle.value = vehicle.value.engine.throttle
      if (!vehicle.value.drivetrain.isShifting) {
        gear.value = vehicle.value.drivetrain.gear
      }
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

    await resumeAudioIfNeeded()
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
  <div class="car-sound-container">
    <div class="tesla-header">
      <div class="back-button" @click="$router.go(-1)">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </div>
      <h1 class="tesla-title">Car Sound</h1>
      <div class="settings-button" @click="showSettings = !showSettings">
        <Settings />
      </div>
    </div>

    <div class="sound-display">
      <div class="mode-row">
        <div class="mode-pill" :class="{ manual: !autoShiftEnabled }">
          {{ shiftModeLabel }}
          <span v-if="!autoShiftEnabled" class="mode-hint-inline">· next/prev gear · auto soon</span>
        </div>
      </div>

      <div class="dashboard">
        <div class="gauge rpm-gauge">
          <div class="gauge-label">RPM</div>
          <div class="gauge-value">{{ rpmDisplay }}</div>
          <div class="gauge-bar">
            <div class="gauge-fill" :style="{ width: `${Math.max(0, Math.min(100, ((rpm - minRpm) / Math.max(maxRpm - minRpm, 1)) * 100))}%` }"></div>
          </div>
        </div>

        <div class="gauge speed-gauge">
          <div class="gauge-label">SPEED</div>
          <div class="gauge-value">{{ speedDisplay }} <span class="gauge-unit">km/h</span></div>
          <div class="gauge-bar">
            <div class="gauge-fill" :style="{ width: `${Math.min(speed / 200, 1) * 100}%` }"></div>
          </div>
        </div>

        <div class="gauge throttle-gauge">
          <div class="gauge-label">LOAD</div>
          <div class="gauge-value">{{ throttleDisplay }}<span class="gauge-unit">%</span></div>
          <div class="gauge-bar">
            <div class="gauge-fill" :style="{ width: `${throttle * 100}%` }"></div>
          </div>
        </div>

        <div class="gauge gear-gauge">
          <div class="gauge-label">GEAR</div>
          <div class="gauge-value gear-display">{{ gearDisplay }}</div>
        </div>
      </div>

      <p class="help-text">
        Engine runs while this page is open. Sound follows movement (GPS + accel). Steering next/prev changes gear (manual), then returns to Auto.
      </p>

      <div class="controls">
        <div class="volume-control">
          <Volume2 class="volume-icon" />
          <input
            type="range"
            min="0"
            max="100"
            :value="volume"
            @input="handleVolumeChange"
            class="volume-slider"
          />
        </div>

        <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
        <p v-else-if="!engineReady" class="help-text">Starting engine…</p>

        <div class="shift-modes">
          <button
            v-for="mode in SHIFT_MODE_LIST"
            :key="mode.id"
            class="mode-button"
            :class="{ active: shiftMode === mode.id }"
            @click="selectShiftMode(mode.id)"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="settings-panel" v-if="showSettings">
      <div class="settings-header">
        <h2 class="settings-title">Settings</h2>
        <button class="close-button" @click="showSettings = false"><X /></button>
      </div>

      <div class="settings-group">
        <label class="settings-label">
          <span>Engine</span>
          <select v-model="selectedConfig" @change="handleConfigChange" class="settings-select">
            <option value="bac_mono">BAC Mono</option>
            <option value="ferr_458">Ferrari 458</option>
            <option value="procar">Procar</option>
          </select>
        </label>

        <label class="settings-label">
          <span>Accel sensitivity: {{ sensitivity }}%</span>
          <input type="range" min="0" max="100" v-model.number="sensitivity" class="settings-slider" />
        </label>
      </div>

      <div class="permissions-info">
        <div class="permission-item" :class="geolocationStatus">GPS: {{ permissionLabel(geolocationStatus) }}</div>
        <div class="permission-item" :class="accelerometerStatus">Accelerometer: {{ permissionLabel(accelerometerStatus) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.car-sound-container {
  min-height: 100vh;
  background-color: black;
  color: white;
  padding: 1rem;
  display: flex;
  flex-direction: column;
}

.tesla-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.back-button,
.settings-button,
.close-button {
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
}

.tesla-title {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.mode-row {
  margin-bottom: 1rem;
}

.mode-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  background: rgba(232, 33, 39, 0.2);
  border: 1px solid rgba(232, 33, 39, 0.5);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mode-pill.manual {
  background: rgba(243, 156, 18, 0.2);
  border-color: rgba(243, 156, 18, 0.55);
}

.mode-hint-inline {
  font-weight: 500;
  opacity: 0.8;
  text-transform: none;
  letter-spacing: 0;
}

.dashboard {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.gauge {
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 0.5rem;
  padding: 1rem;
}

.gauge-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 0.25rem;
  letter-spacing: 0.05em;
}

.gauge-value {
  font-size: 2rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}

.gauge-unit {
  font-size: 1rem;
  opacity: 0.7;
}

.gauge-bar {
  height: 0.5rem;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 0.25rem;
  overflow: hidden;
}

.gauge-fill {
  height: 100%;
  border-radius: 0.25rem;
  transition: width 0.15s ease;
}

.rpm-gauge .gauge-fill { background-color: #e82127; }
.speed-gauge .gauge-fill { background-color: #3498db; }
.throttle-gauge .gauge-fill { background-color: #f39c12; }

.gear-gauge { text-align: center; }
.gear-display {
  font-size: 3rem !important;
  font-weight: 700;
  color: #e82127;
  margin-bottom: 0 !important;
}

.help-text {
  margin: 1rem 0 0;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.4;
}

.controls { margin-top: 1.5rem; }

.volume-control {
  display: flex;
  align-items: center;
  margin-bottom: 1.25rem;
  gap: 1rem;
}

.volume-icon { width: 1.5rem; height: 1.5rem; }

.volume-slider {
  flex: 1;
  height: 0.25rem;
  -webkit-appearance: none;
  appearance: none;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 0.125rem;
  outline: none;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background-color: white;
  cursor: pointer;
}

.error-message {
  margin-top: 0.75rem;
  color: #e82127;
  font-size: 0.875rem;
  text-align: center;
}

.shift-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-top: 1rem;
}

.mode-button {
  padding: 0.65rem 0.25rem;
  background-color: rgba(255, 255, 255, 0.06);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.mode-button.active {
  background-color: rgba(232, 33, 39, 0.35);
  border-color: #e82127;
}

.settings-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 85%;
  max-width: 400px;
  background-color: #1a1a1a;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
  padding: 2rem 1.5rem;
  z-index: 100;
  overflow-y: auto;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.settings-title { font-size: 1.25rem; font-weight: 600; }

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  margin-bottom: 1.5rem;
}

.settings-label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.settings-select,
.settings-slider {
  width: 100%;
}

.settings-select {
  background: #111;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0.4rem;
  padding: 0.6rem;
}

.settings-slider {
  height: 0.25rem;
  -webkit-appearance: none;
  appearance: none;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 0.125rem;
}

.settings-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background-color: white;
  cursor: pointer;
}

.permissions-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.permission-item { color: rgba(255, 255, 255, 0.55); }
.permission-item.allowed { color: #2ecc71; }
.permission-item.pending { color: #f39c12; }
.permission-item.denied { color: #e82127; }
</style>
