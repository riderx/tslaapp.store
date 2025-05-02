<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSpeedStore } from '../stores/speedStore'
import SpeedGraph from '../components/SpeedGraph.vue'

const router = useRouter()
const speedStore = useSpeedStore()
const showAnimation = ref(true)

// If no test was completed, redirect back to test page
onMounted(() => {
  if (speedStore.endTime === 0) {
    router.push('/')
  }
  
  // Hide animation after 3 seconds
  setTimeout(() => {
    showAnimation.value = false
  }, 3000)
})

const tryAgain = () => {
  router.push('/')
}

const targetReached = computed(() => {
  return speedStore.maxSpeed >= speedStore.targetSpeedInCurrentUnit
})

const performanceRating = computed(() => {
  if (!targetReached.value) return 'Incomplete'
  
  const time = parseFloat(speedStore.formattedTime)
  
  if (time < 3) return 'Ludicrous!'
  if (time < 4) return 'Insane!'
  if (time < 5) return 'Excellent'
  if (time < 6) return 'Great'
  if (time < 8) return 'Good'
  
  return 'Average'
})

const performanceColor = computed(() => {
  if (!targetReached.value) return '#888'
  
  const time = parseFloat(speedStore.formattedTime)
  
  if (time < 3) return '#e82127'
  if (time < 4) return '#ff3a2f'
  if (time < 5) return '#ff7b00'
  if (time < 6) return '#ffa700'
  if (time < 8) return '#ffd000'
  
  return '#83d300'
})
</script>

<template>
  <main class="results-page">
    <div class="result-animation" v-if="showAnimation">
      <div class="time-reveal">
        <span>{{ speedStore.formattedTime }}</span>
        <small>seconds</small>
      </div>
    </div>
    
    <template v-else>
      <header class="results-header">
        <h1>Your Results</h1>
      </header>
      
      <section class="results-content">
        <div class="time-container">
          <div class="time-card">
            <div class="time-value">{{ speedStore.formattedTime }}</div>
            <div class="time-label">seconds</div>
          </div>
          
          <div class="performance-rating" :style="{ color: performanceColor }">
            {{ performanceRating }}
          </div>
        </div>
        
        <div class="details-card">
          <div class="detail-row">
            <span class="detail-label">Test</span>
            <span class="detail-value">0-{{ speedStore.targetSpeedInCurrentUnit }} {{ speedStore.displayUnit }}</span>
          </div>
          
          <div class="detail-row">
            <span class="detail-label">Max Speed</span>
            <span class="detail-value">{{ speedStore.maxSpeed.toFixed(1) }} {{ speedStore.displayUnit }}</span>
          </div>
        </div>
        
        <div class="graph-container">
          <h2>Acceleration Curve</h2>
          <SpeedGraph />
        </div>
      </section>
      
      <footer class="results-footer">
        <button class="button-primary" @click="tryAgain">
          TEST AGAIN
        </button>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.results-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  background-color: var(--tesla-dark);
  color: var(--tesla-white);
}

.result-animation {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.time-reveal {
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: zoomIn 0.5s ease-out forwards;
}

.time-reveal span {
  font-size: 8rem;
  font-weight: 700;
  color: var(--tesla-red);
}

.time-reveal small {
  font-size: 2rem;
  color: var(--tesla-light-gray);
}

.results-header {
  padding: 24px;
  text-align: center;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
}

.results-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  overflow-y: auto;
}

.time-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 32px;
}

.time-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  border-radius: 16px;
  background-color: rgba(255, 255, 255, 0.05);
  margin-bottom: 16px;
}

.time-value {
  font-size: 5rem;
  font-weight: 700;
  color: var(--tesla-red);
}

.time-label {
  font-size: 1.5rem;
  color: var(--tesla-light-gray);
}

.performance-rating {
  font-size: 2rem;
  font-weight: 600;
}

.details-card {
  padding: 24px;
  border-radius: 16px;
  background-color: rgba(255, 255, 255, 0.05);
  margin-bottom: 32px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  font-size: 1.1rem;
  color: var(--tesla-light-gray);
}

.detail-value {
  font-size: 1.1rem;
  font-weight: 600;
}

.graph-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-bottom: 24px;
}

.graph-container h2 {
  font-size: 1.5rem;
  margin-bottom: 16px;
  text-align: center;
}

.results-footer {
  padding: 24px;
  display: flex;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.3);
}

@keyframes zoomIn {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Responsive adjustments */
@media (max-width: 600px) {
  .time-value {
    font-size: 4rem;
  }
  
  .time-reveal span {
    font-size: 5rem;
  }
  
  .time-reveal small {
    font-size: 1.5rem;
  }
}
</style>