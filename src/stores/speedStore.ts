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
  
  // Load history from localStorage
  const loadHistory = () => {
    const savedHistory = localStorage.getItem('testHistory')
    if (savedHistory) {
      testHistory.value = JSON.parse(savedHistory)
    }
  }
  
  // Save history to localStorage
  const saveHistory = () => {
    localStorage.setItem('testHistory', JSON.stringify(testHistory.value))
  }
  
  // Initialize history on store creation
  loadHistory()
  
  function saveTestResult() {
    const result: TestResult = {
      id: crypto.randomUUID(),
      time: parseFloat(formattedTime.value),
      maxSpeed: maxSpeed.value,
      targetSpeed: targetSpeedInCurrentUnit.value,
      isMetric: isMetric.value,
      date: new Date().toISOString(),
      speedLog: [...speedLog.value]
    }
    
    testHistory.value.unshift(result)
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
      requestGeolocationPermission()
      return
    }
    
    if (permissionDenied.value) {
      return
    }
    
    resetTest()
    isRunning.value = true
    speedLog.value = []
    
    watchId.value = navigator.geolocation.watchPosition(
      handleGeolocationUpdate,
      handleGeolocationError,
      { enableHighAccuracy: true, maximumAge: 0 }
    )
  }
  
  function resetTest() {
    if (watchId.value !== null) {
      navigator.geolocation.clearWatch(watchId.value)
      watchId.value = null
    }
    
    isRunning.value = false
    currentSpeed.value = 0
    maxSpeed.value = 0
    startTime.value = 0
    endTime.value = 0
    speedLog.value = []
    totalDistance.value = 0
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
    
    // Calculate elapsed time and distance
    const elapsedTime = (Date.now() - startTime.value) / 1000 // seconds
    const distanceInMeters = speedInMps * elapsedTime
    totalDistance.value = distanceInMeters
    
    // Log the speed
    speedLog.value.push({
      time: Date.now() - startTime.value,
      speed: speed
    })
    
    // Check if we've reached target
    const targetReached = selectedTestType.value === 'acceleration'
      ? speed >= targetSpeedInCurrentUnit.value
      : distanceInMeters >= selectedTarget.value
    
    if (targetReached && endTime.value === 0) {
      endTime.value = Date.now()
      isRunning.value = false
      navigator.geolocation.clearWatch(watchId.value as number)
      watchId.value = null
      
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
  }
  
  function requestGeolocationPermission() {
    navigator.geolocation.getCurrentPosition(
      () => {
        hasPermission.value = true
        permissionDenied.value = false
        // Only start the test if permission was explicitly granted
        if (hasPermission.value && !permissionDenied.value) {
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
  
  // Check permission on store creation
  requestGeolocationPermission()
  
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
