<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Pause, Play, Volume2, Settings, X, ZapIcon } from 'lucide-vue-next'
import { SoundGeneratorAudioListener, EngineSoundGenerator } from '/src/engine/engine_sound_generator/sound_generator_worklet_wasm.js'
import * as THREE from '/src/engine/three_js/build/three.module.js'

// Engine sound generator state
const audioContext = ref<AudioContext | null>(null)
const soundGenerator = ref<any>(null)
const rpm = ref(800)
const volume = ref(50)
const isPlaying = ref(false)
const showSettings = ref(false)

// Sensor data
const speed = ref(0)
const acceleration = ref(0)
const hasAccelerometerPermission = ref(false)
const hasGeolocationPermission = ref(false)

// Settings
const maxRpm = ref(8000)
const minRpm = ref(800)
const sensitivity = ref(50)
const useGps = ref(true)
const useAccelerometer = ref(true)

// Test acceleration
const isAccelerating = ref(false)
const testAccelerationValue = ref(50)

// Toggle play/pause
const togglePlay = async () => {
  try {
    // First create or resume AudioContext if needed
    if (!audioContext.value) {
      // Create AudioContext (must happen in response to user action)
      audioContext.value = new AudioContext()
    }
    
    if (audioContext.value.state === 'suspended') {
      await audioContext.value.resume()
    }
    
    // Then initialize sound generator if needed
    if (!soundGenerator.value) {
      await initSoundGenerator()
    }
    
    // If we still don't have a sound generator, abort
    if (!soundGenerator.value) {
      console.error('Failed to initialize sound generator')
      return
    }
    
    // Toggle play state
    if (isPlaying.value) {
      soundGenerator.value.stop()
    } else {
      soundGenerator.value.play()
      startSensors()
    }
    
    isPlaying.value = !isPlaying.value
  } catch (error) {
    console.error('Error toggling sound generator:', error)
  }
}

// Initialize sound generator
const initSoundGenerator = async () => {
  try {
    // Make sure we have an AudioContext created first
    if (!audioContext.value) {
      console.error('AudioContext must be created before initializing sound generator')
      return
    }
    
    console.log('Initializing sound generator with AudioContext', audioContext.value)
    
    // Create listener
    const listener = new SoundGeneratorAudioListener()
    
    // Load sound generator using loadingManager
    await new Promise<void>((resolve) => {
      const loadingManager = new THREE.LoadingManager()
      loadingManager.onLoad = () => {
        console.log('Sound generator modules loaded')
        resolve()
      }
      
      // Pass the path to the sound_generator_wasm directory
      EngineSoundGenerator.load(loadingManager, listener, '/src/engine/engine_sound_generator')
    })
    
    // Create engine sound generator
    soundGenerator.value = new EngineSoundGenerator({
      listener,
      parameters: {
        // cylinders: 8,
        // intakeWaveguideLength: 100,
        // exhaustWaveguideLength: 100,
        // extractorWaveguideLength: 100,
        // intakeOpenReflectionFactor: 0.01,
        // intakeClosedReflectionFactor: 0.95,
        // exhaustOpenReflectionFactor: 0.01,
        // exhaustClosedReflectionFactor: 0.95,
        // ignitionTime: 0.016,
        // straightPipeWaveguideLength: 128,
        // straightPipeReflectionFactor: 0.01,
        // mufflerElementsLength: [10, 15, 20, 25],
        // action: 0.1,
        // outletWaveguideLength: 5,
        // outletReflectionFactor: 0.01
        cylinders: 4,

                                    intakeWaveguideLength: 100,
                                    exhaustWaveguideLength: 100,
                                    extractorWaveguideLength: 100,

                                    intakeOpenReflectionFactor: 0.01,
                                    intakeClosedReflectionFactor: 0.95,

                                    exhaustOpenReflectionFactor: 0.01,
                                    exhaustClosedReflectionFactor: 0.95,
                                    ignitionTime: 0.016,

                                    straightPipeWaveguideLength: 128,
                                    straightPipeReflectionFactor: 0.01,

                                    mufflerElementsLength: [10, 15, 20, 25],
                                    action: 0.1,

                                    outletWaveguideLength: 5,
                                    outletReflectionFactor: 0.01
      }
    })
    
    // Set volume
    updateVolume()
    
    // Update RPM
    updateRPM()
    
    console.log('Sound generator initialized successfully')
  } catch (error) {
    console.error('Failed to initialize sound generator:', error)
  }
}

// Update RPM based on sensor data
const updateRPM = () => {
  // Calculate RPM based on speed (GPS) and acceleration
  if (!isPlaying.value) return
  
  let newRpm = minRpm.value
  
  // Factor in speed if GPS is enabled
  if (useGps.value && hasGeolocationPermission.value) {
    // Map speed (0-200 km/h) to RPM range
    const speedFactor = Math.min(speed.value / 200, 1)
    newRpm += speedFactor * (maxRpm.value - minRpm.value) * 0.7
  }
  
  // Factor in acceleration if accelerometer is enabled
  if (useAccelerometer.value && hasAccelerometerPermission.value) {
    // Use acceleration to add dynamic RPM changes
    const accelFactor = (acceleration.value + 10) / 20 // Map -10 to 10 range to 0-1
    const accelInfluence = (sensitivity.value / 100) * (maxRpm.value - minRpm.value) * 0.3
    newRpm += accelFactor * accelInfluence
  }
  
  // Apply test acceleration if active
  if (isAccelerating.value) {
    const testAccelFactor = testAccelerationValue.value / 100
    const testAccelInfluence = (maxRpm.value - minRpm.value) * 0.7
    newRpm += testAccelFactor * testAccelInfluence
  }
  
  // Clamp RPM to valid range
  rpm.value = Math.max(minRpm.value, Math.min(newRpm, maxRpm.value))
  
  // Update sound generator RPM
  if (soundGenerator.value?.worklet?.parameters) {
    const rpmParam = soundGenerator.value.worklet.parameters.get('rpm')
    if (rpmParam) rpmParam.value = rpm.value
  }
}

// Toggle test acceleration
const toggleTestAcceleration = () => {
  isAccelerating.value = !isAccelerating.value
  if (isAccelerating.value) {
    // Start acceleration test
    updateRPM()
    // Schedule automatic stop after 3 seconds
    setTimeout(() => {
      isAccelerating.value = false
      updateRPM()
    }, 3000)
  } else {
    // Stop acceleration test immediately
    updateRPM()
  }
}

// Update test acceleration value
const handleTestAccelerationChange = (e: Event) => {
  testAccelerationValue.value = parseInt((e.target as HTMLInputElement).value)
  if (isAccelerating.value) {
    updateRPM()
  }
}

// Update volume
const updateVolume = () => {
  if (soundGenerator.value?.worklet?.parameters) {
    const volumeParam = soundGenerator.value.worklet.parameters.get('volume')
    if (volumeParam) volumeParam.value = volume.value / 100
  }
}

// Start sensor monitoring
const startSensors = () => {
  // Request accelerometer permission and start monitoring
  if (useAccelerometer.value && 'DeviceMotionEvent' in window) {
    try {
      if ((DeviceMotionEvent as any).requestPermission) {
        (DeviceMotionEvent as any).requestPermission()
          .then((state: string) => {
            if (state === 'granted') {
              hasAccelerometerPermission.value = true
              window.addEventListener('devicemotion', handleMotion)
            }
          })
          .catch(console.error)
      } else {
        // Permission not required
        hasAccelerometerPermission.value = true
        window.addEventListener('devicemotion', handleMotion)
      }
    } catch (error) {
      console.error('Accelerometer error:', error)
    }
  }
  
  // Request geolocation permission and start monitoring
  if (useGps.value && 'geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      () => {
        hasGeolocationPermission.value = true
        startWatchingPosition()
      },
      (error) => {
        console.error('Geolocation error:', error)
      },
      { enableHighAccuracy: true }
    )
  }
}

// Handle accelerometer data
const handleMotion = (event: DeviceMotionEvent) => {
  if (!event.acceleration) return
  
  // Get forward/backward acceleration (y-axis in portrait mode)
  const y = event.acceleration.y || 0
  
  // Update acceleration value
  acceleration.value = y
  
  // Update RPM based on new acceleration
  updateRPM()
}

// Watch position for speed calculation
let watchId: number
const startWatchingPosition = () => {
  let lastPosition: GeolocationPosition | null = null
  let lastTime = 0
  
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now()
      
      if (lastPosition && lastTime) {
        // Calculate distance between points
        const distance = calculateDistance(
          lastPosition.coords.latitude,
          lastPosition.coords.longitude,
          position.coords.latitude,
          position.coords.longitude
        )
        
        // Calculate time difference in hours
        const timeDiff = (now - lastTime) / 3600000
        
        // Calculate speed in km/h
        if (timeDiff > 0) {
          speed.value = distance / timeDiff
          
          // Update RPM based on new speed
          updateRPM()
        }
      }
      
      lastPosition = position
      lastTime = now
    },
    (error) => {
      console.error('Geolocation watching error:', error)
    },
    { enableHighAccuracy: true, maximumAge: 0 }
  )
}

// Calculate distance between two points using Haversine formula
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371 // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Handle volume change
const handleVolumeChange = (e: Event) => {
  volume.value = parseInt((e.target as HTMLInputElement).value)
  updateVolume()
}

// Formatted RPM display
const rpmDisplay = computed(() => {
  return Math.round(rpm.value).toLocaleString()
})

// Format speed
const speedDisplay = computed(() => {
  return Math.round(speed.value).toLocaleString()
})

// Cleanup on component unmount
onUnmounted(() => {
  if (isPlaying.value && soundGenerator.value) {
    soundGenerator.value.stop()
  }
  
  if (audioContext.value) {
    audioContext.value.close()
  }
  
  window.removeEventListener('devicemotion', handleMotion)
  
  if (watchId) {
    navigator.geolocation.clearWatch(watchId)
  }
})

// Toggle settings panel
const toggleSettings = () => {
  showSettings.value = !showSettings.value
}
</script>

<template>
  <div class="car-sound-container">
    <div class="tesla-header">
      <div class="back-button" @click="$router.go(-1)">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </div>
      <h1 class="tesla-title">Sound Generator</h1>
      <div class="settings-button" @click="toggleSettings">
        <Settings />
      </div>
    </div>
    
    <div class="sound-display">
      <div class="dashboard">
        <div class="gauge rpm-gauge">
          <div class="gauge-label">RPM</div>
          <div class="gauge-value">{{ rpmDisplay }}</div>
          <div class="gauge-bar">
            <div class="gauge-fill" :style="{ width: `${(rpm - minRpm) / (maxRpm - minRpm) * 100}%` }"></div>
          </div>
        </div>
        
        <div class="gauge speed-gauge">
          <div class="gauge-label">SPEED</div>
          <div class="gauge-value">{{ speedDisplay }} <span class="gauge-unit">km/h</span></div>
          <div class="gauge-bar">
            <div class="gauge-fill" :style="{ width: `${Math.min(speed / 200, 1) * 100}%` }"></div>
          </div>
        </div>
      </div>
      
      <div class="car-animation">
        <div class="car-icon" :class="{ 'car-accelerating': rpm > minRpm + 500 || isAccelerating }">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" fill="currentColor">
            <path d="M171.3 96H224v96H111.3l30.4-75.9C146.5 104 158.2 96 171.3 96zM272 192V96h81.2c9.7 0 18.9 4.4 25 12l67.2 84H272zm256.2 1L428.2 68c-18.2-22.8-45.8-36-75-36H171.3c-39.3 0-74.6 23.9-89.1 60.3L40.6 196.4C16.8 205.8 0 228.9 0 256V368c0 17.7 14.3 32 32 32H65.3c7.6 45.4 47.1 80 94.7 80s87.1-34.6 94.7-80H385.3c7.6 45.4 47.1 80 94.7 80s87.1-34.6 94.7-80H608c17.7 0 32-14.3 32-32V320c0-65.2-48.8-119-111.8-127zM434.7 368a48 48 0 1 1 90.5 32 48 48 0 1 1 -90.5-32zM160 336a48 48 0 1 1 0 96 48 48 0 1 1 0-96z"/>
          </svg>
        </div>
      </div>
      
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
        
        <button class="play-button" @click="togglePlay">
          <component :is="isPlaying ? Pause : Play" class="play-icon" />
          <span>{{ isPlaying ? 'Stop' : 'Start' }} Engine</span>
        </button>
      </div>
    </div>
    
    <div class="settings-panel" v-if="showSettings">
      <div class="settings-header">
        <h2 class="settings-title">Settings</h2>
        <button class="close-button" @click="toggleSettings">
          <X />
        </button>
      </div>
      
      <div class="settings-group">
        <label class="settings-label">
          <span>Min RPM: {{ minRpm }}</span>
          <input
            type="range"
            min="500"
            max="2000"
            step="50"
            v-model.number="minRpm"
            class="settings-slider"
          />
        </label>
        
        <label class="settings-label">
          <span>Max RPM: {{ maxRpm }}</span>
          <input
            type="range"
            min="4000"
            max="12000"
            step="100"
            v-model.number="maxRpm"
            class="settings-slider"
          />
        </label>
        
        <label class="settings-label">
          <span>Sensitivity: {{ sensitivity }}%</span>
          <input
            type="range"
            min="0"
            max="100"
            v-model.number="sensitivity"
            class="settings-slider"
          />
        </label>
      </div>
      
      <div class="settings-group">
        <label class="settings-toggle">
          <input type="checkbox" v-model="useGps" />
          <span>Use GPS for speed</span>
        </label>
        
        <label class="settings-toggle">
          <input type="checkbox" v-model="useAccelerometer" />
          <span>Use accelerometer</span>
        </label>
      </div>
      
      <div class="settings-group">
        <h3 class="settings-subtitle">Test Acceleration</h3>
        <label class="settings-label">
          <span>Acceleration Power: {{ testAccelerationValue }}%</span>
          <input
            type="range"
            min="0"
            max="100"
            v-model.number="testAccelerationValue"
            @input="handleTestAccelerationChange"
            class="settings-slider"
          />
        </label>
        <button 
          class="test-button" 
          @click="toggleTestAcceleration"
          :class="{ 'test-active': isAccelerating }"
          :disabled="!isPlaying"
        >
          <ZapIcon class="test-icon" />
          <span>{{ isAccelerating ? 'ACCELERATING...' : 'TEST ACCELERATION' }}</span>
        </button>
        <p class="test-info" v-if="!isPlaying">Start the engine to test acceleration</p>
      </div>
      
      <div class="permissions-info">
        <div class="permission-item" :class="{ active: hasGeolocationPermission }">
          GPS: {{ hasGeolocationPermission ? 'Allowed' : 'Not allowed' }}
        </div>
        <div class="permission-item" :class="{ active: hasAccelerometerPermission }">
          Accelerometer: {{ hasAccelerometerPermission ? 'Allowed' : 'Not allowed' }}
        </div>
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
  margin-bottom: 2rem;
}

.back-button, .settings-button {
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.1);
  transition: background-color 0.2s;
}

.back-button:hover, .settings-button:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.tesla-title {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.sound-display {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2rem;
}

.dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin-bottom: 1rem;
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
  font-weight: 500;
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
  background-color: #e82127;
  border-radius: 0.25rem;
  transition: width 0.2s ease;
}

.rpm-gauge .gauge-fill {
  background-color: #e82127;
}

.speed-gauge .gauge-fill {
  background-color: #3498db;
}

.car-animation {
  display: flex;
  justify-content: center;
  margin: 2rem 0;
}

.car-icon {
  width: 200px;
  color: white;
  position: relative;
  transition: transform 0.2s ease;
}

.car-accelerating {
  animation: car-shake 0.1s infinite;
}

@keyframes car-shake {
  0% { transform: translateX(-1px) }
  25% { transform: translateX(1px) }
  50% { transform: translateX(-0.5px) }
  75% { transform: translateX(0.5px) }
  100% { transform: translateX(0) }
}

.controls {
  margin-top: 2rem;
}

.volume-control {
  display: flex;
  align-items: center;
  margin-bottom: 1.5rem;
  gap: 1rem;
}

.volume-icon {
  width: 1.5rem;
  height: 1.5rem;
}

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

.play-button {
  width: 100%;
  padding: 1rem;
  background-color: #e82127;
  color: white;
  border: none;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.play-button:hover {
  background-color: #c91c21;
}

.play-icon {
  width: 1.5rem;
  height: 1.5rem;
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
  animation: slide-in 0.3s ease;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2rem;
}

.close-button {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-button:hover {
  color: white;
  background-color: rgba(255, 255, 255, 0.1);
}

@keyframes slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.settings-title {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.settings-subtitle {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: rgba(255, 255, 255, 0.8);
}

.settings-group {
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.settings-label {
  display: flex;
  flex-direction: column;
  margin-bottom: 1.5rem;
}

.settings-label span {
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

.settings-slider {
  -webkit-appearance: none;
  height: 0.25rem;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 0.125rem;
  outline: none;
}

.settings-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background-color: #e82127;
  cursor: pointer;
}

.settings-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  cursor: pointer;
}

.settings-toggle input {
  -webkit-appearance: none;
  appearance: none;
  width: 2.5rem;
  height: 1.25rem;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 1rem;
  position: relative;
  cursor: pointer;
}

.settings-toggle input::before {
  content: '';
  position: absolute;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background-color: white;
  top: 0.125rem;
  left: 0.125rem;
  transition: transform 0.2s;
}

.settings-toggle input:checked {
  background-color: #e82127;
}

.settings-toggle input:checked::before {
  transform: translateX(1.25rem);
}

.test-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.75rem;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.test-button:hover:not(:disabled) {
  background-color: #2980b9;
}

.test-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.test-active {
  background-color: #e74c3c;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.8; }
  100% { opacity: 1; }
}

.test-icon {
  width: 1.25rem;
  height: 1.25rem;
}

.test-info {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  margin-top: 0.5rem;
}

.permissions-info {
  margin-top: 2rem;
}

.permission-item {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
}

.permission-item.active {
  color: #4cd964;
}
</style> 
