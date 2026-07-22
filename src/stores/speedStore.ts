import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

interface TestResult {
  id: string
  time: number
  maxSpeed: number
  targetSpeed: number
  isMetric: boolean
  date: string
  speedLog: Array<{time: number, speed: number}>
}

const MAX_SPEED_LOG_POINTS = 600
const MAX_HISTORY_ITEMS = 50
const MIN_LOG_INTERVAL_MS = 100

export const useSpeedStore = defineStore('speed', () => {
  const router = useRouter()
  
  // State
  const currentSpeed = ref(0)
  const maxSpeed = ref(0)
  const isMetric = ref(false)
  const isRunning = ref(false)
  const startTime = ref(0)
  const endTime = ref(0)
  const speedLog = ref<{time: number, speed: number}[]>([])
  const watchId = ref<number | null>(null)
  const hasPermission = ref(false)
  const permissionDenied = ref(false)
  const testHistory = ref<TestResult[]>([])
  const totalDistance = ref(0)
  let lastLogTime = 0
  let lastPosition: GeolocationPosition | null = null
  
  // Test types and targets
  const selectedTestType = ref<'acceleration' | 'distance'>('acceleration')
  const selectedTarget = ref<number>(60)
  
  const testTypes = [
    { type: 'acceleration', label: 'Acceleration Test' },
    { type: 'distance', label: 'Distance Test' }
  ]
  
  const targets = {
    acceleration: [
      { value: 60, label: computed(() => isMetric.value ? '0-96 km/h' : '0-60 mph') },
      { value: 100, label: computed(() => isMetric.value ? '0-161 km/h' : '0-100 mph') },
      { value: 150, label: computed(() => isMetric.value ? '0-241 km/h' : '0-150 mph') }
    ],
    distance: [
      { value: 400, label: computed(() => isMetric.value ? '400m' : '1/4 mile') },
      { value: 800, label: computed(() => isMetric.value ? '800m' : '1/2 mile') },
      { value: 1600, label: computed(() => isMetric.value ? '1.6 km' : '1 mile') }
    ]
  }
  
  // Computed
  const displayUnit = computed(() => isMetric.value ? 'km/h' : 'mph')
  
  const currentTargets = computed(() => {
    return targets[selectedTestType.value]
  })
  
  const targetSpeedInCurrentUnit = computed(() => {
    if (selectedTestType.value === 'acceleration') {
      return isMetric.value ? selectedTarget.value * 1.60934 : selectedTarget.value
    }
    return selectedTarget.value
  })
  
  const formattedTime = computed(() => {
    if (startTime.value === 0 || endTime.value === 0) return '0.00'
    const time = (endTime.value - startTime.value) / 1000
    return time.toFixed(2)
  })

  function downsampleLog(log: Array<{time: number, speed: number}>, maxPoints: number) {
    if (log.length <= maxPoints) return log
    const step = log.length / maxPoints
    const sampled: Array<{time: number, speed: number}> = []
    for (let i = 0; i < maxPoints - 1; i++) {
      sampled.push(log[Math.floor(i * step)])
    }
    sampled.push(log[log.length - 1])
    return sampled
  }
  
  // Load history from localStorage
  const loadHistory = () => {
    try {
      const savedHistory = localStorage.getItem('testHistory')
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory) as TestResult[]
        testHistory.value = parsed.slice(0, MAX_HISTORY_ITEMS).map((item) => ({
          ...item,
          speedLog: downsampleLog(item.speedLog || [], 120)
        }))
      }
    } catch {
      testHistory.value = []
      localStorage.removeItem('testHistory')
    }
  }
  
  // Save history to localStorage
  const saveHistory = () => {
    try {
      const trimmed = testHistory.value.slice(0, MAX_HISTORY_ITEMS).map((item) => ({
        ...item,
        speedLog: downsampleLog(item.speedLog || [], 120)
      }))
      localStorage.setItem('testHistory', JSON.stringify(trimmed))
    } catch {
      // Quota exceeded — drop oldest entries and retry once
      testHistory.value = testHistory.value.slice(0, 10).map((item) => ({
        ...item,
        speedLog: downsampleLog(item.speedLog || [], 60)
      }))
      try {
        localStorage.setItem('testHistory', JSON.stringify(testHistory.value))
      } catch {
        localStorage.removeItem('testHistory')
      }
    }
  }
  
  // Initialize history on store creation
  loadHistory()

  function clearWatch() {
    if (watchId.value !== null) {
      navigator.geolocation.clearWatch(watchId.value)
      watchId.value = null
    }
  }
  
  function saveTestResult() {
    const result: TestResult = {
      id: crypto.randomUUID(),
      time: parseFloat(formattedTime.value),
      maxSpeed: maxSpeed.value,
      targetSpeed: targetSpeedInCurrentUnit.value,
      isMetric: isMetric.value,
      date: new Date().toISOString(),
      speedLog: downsampleLog(speedLog.value, 120)
    }
    
    testHistory.value.unshift(result)
    if (testHistory.value.length > MAX_HISTORY_ITEMS) {
      testHistory.value = testHistory.value.slice(0, MAX_HISTORY_ITEMS)
    }
    saveHistory()
  }
  
  function deleteTestResult(id: string) {
    testHistory.value = testHistory.value.filter(test => test.id !== id)
    saveHistory()
  }
  
  function clearAllTestResults() {
    testHistory.value = []
    saveHistory()
  }
  
  function startTest() {
    if (!hasPermission.value) {
      requestGeolocationPermission(true)
      return
    }
    
    if (permissionDenied.value) {
      return
    }
    
    resetTest()
    isRunning.value = true
    speedLog.value = []
    lastLogTime = 0
    lastPosition = null
    
    watchId.value = navigator.geolocation.watchPosition(
      handleGeolocationUpdate,
      handleGeolocationError,
      { enableHighAccuracy: true, maximumAge: 0 }
    )
  }
  
  function resetTest() {
    clearWatch()
    
    isRunning.value = false
    currentSpeed.value = 0
    maxSpeed.value = 0
    startTime.value = 0
    endTime.value = 0
    speedLog.value = []
    totalDistance.value = 0
    lastLogTime = 0
    lastPosition = null
  }
  
  function handleGeolocationUpdate(position: GeolocationPosition) {
    if (!isRunning.value) return
    
    // Speed comes in m/s, convert to mph or km/h
    const speedInMps = position.coords.speed || 0
    let speed = isMetric.value 
      ? speedInMps * 3.6  // m/s to km/h
      : speedInMps * 2.237 // m/s to mph
    
    // Round to 1 decimal
    speed = Math.round(speed * 10) / 10
    currentSpeed.value = speed
    
    // Start timer only when actual movement is detected
    const SPEED_THRESHOLD = 1 // mph or km/h
    if (startTime.value === 0 && speed > SPEED_THRESHOLD) {
      startTime.value = Date.now()
    }
    
    // Only proceed with calculations if the timer has started
    if (startTime.value === 0) return
    
    // Update max speed
    if (speed > maxSpeed.value) {
      maxSpeed.value = speed
    }
    
    // Accumulate distance from position deltas when available
    if (lastPosition) {
      const dt = (position.timestamp - lastPosition.timestamp) / 1000
      if (dt > 0 && dt < 5) {
        totalDistance.value += speedInMps * dt
      }
    }
    lastPosition = position
    
    // Throttle speed log to avoid unbounded growth / OOM
    const now = Date.now()
    if (now - lastLogTime >= MIN_LOG_INTERVAL_MS) {
      lastLogTime = now
      speedLog.value.push({
        time: now - startTime.value,
        speed: speed
      })
      if (speedLog.value.length > MAX_SPEED_LOG_POINTS) {
        speedLog.value.splice(0, speedLog.value.length - MAX_SPEED_LOG_POINTS)
      }
    }
    
    // Check if we've reached target
    const targetReached = selectedTestType.value === 'acceleration'
      ? speed >= targetSpeedInCurrentUnit.value
      : totalDistance.value >= selectedTarget.value
    
    if (targetReached && endTime.value === 0) {
      endTime.value = Date.now()
      isRunning.value = false
      clearWatch()
      
      // Save the test result
      saveTestResult()
      
      // Navigate to results page
      router.push('/results')
    }
  }
  
  function handleGeolocationError(error: GeolocationPositionError) {
    console.error('Geolocation error:', error)
    if (error.code === error.PERMISSION_DENIED) {
      permissionDenied.value = true
      hasPermission.value = false
    }
    isRunning.value = false
    clearWatch()
  }
  
  function requestGeolocationPermission(autoStart = false) {
    navigator.geolocation.getCurrentPosition(
      () => {
        hasPermission.value = true
        permissionDenied.value = false
        if (autoStart) {
          startTest()
        }
      },
      (error) => {
        console.error('Permission error:', error)
        if (error.code === error.PERMISSION_DENIED) {
          permissionDenied.value = true
          hasPermission.value = false
        }
      },
      { enableHighAccuracy: true }
    )
  }
  
  // Check permission on store creation — do not auto-start a test
  requestGeolocationPermission(false)
  
  return {
    currentSpeed,
    maxSpeed,
    isMetric,
    isRunning,
    startTime,
    endTime,
    speedLog,
    hasPermission,
    permissionDenied,
    displayUnit,
    targetSpeedInCurrentUnit,
    formattedTime,
    testHistory,
    totalDistance,
    selectedTestType,
    selectedTarget,
    testTypes,
    currentTargets,
    startTest,
    resetTest,
    deleteTestResult,
    clearAllTestResults,
    requestGeolocationPermission
  }
})
