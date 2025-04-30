<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSpeedStore } from '../stores/speedStore'

const COUNTDOWN_STEPS = ['5', '4', '3', '2', '1', 'GO!']
const speedStore = useSpeedStore()
const countdownIndex = ref(-1)
const countdownInterval = ref<number | null>(null)
const showCountdown = ref(false)

watch(() => speedStore.isRunning, (newValue) => {
  if (newValue) {
    startCountdown()
  } else {
    clearCountdown()
  }
})

function clearCountdown() {
  if (countdownInterval.value) {
    clearInterval(countdownInterval.value)
    countdownInterval.value = null
  }
  showCountdown.value = false
  countdownIndex.value = -1
}

function startCountdown() {
  showCountdown.value = true
  countdownIndex.value = 0
  
  countdownInterval.value = setInterval(() => {
    countdownIndex.value++
    if (countdownIndex.value >= COUNTDOWN_STEPS.length) {
      clearInterval(countdownInterval.value!)
      countdownInterval.value = null
      setTimeout(() => {
        showCountdown.value = false
      }, 1000)
    }
  }, 1000)
}
</script>

<template>
  <div class="countdown-overlay" v-if="showCountdown">
    <div class="countdown-number">{{ COUNTDOWN_STEPS[countdownIndex] }}</div>
  </div>
</template>

<style scoped>
.countdown-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(0, 0, 0, 0.8);
  z-index: 100;
}

.countdown-number {
  font-size: 8rem;
  font-weight: 700;
  color: var(--tesla-red);
  animation: countdownPulse 0.5s ease-out;
  text-shadow: 0 0 20px rgba(232, 33, 39, 0.4);
}

@keyframes countdownPulse {
  0% { transform: scale(1.5); opacity: 0; }
  50% { transform: scale(0.9); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
</style>