<script setup lang="ts">
import { useSpeedStore } from '../stores/speedStore'
import Speedometer from './Speedometer.vue'

const speedStore = useSpeedStore()
</script>

<template>
  <div class="speed-display-container">
    <Speedometer :animated="true" />
    
    <div class="speed-display">
      <div class="current-speed">
        <span class="speed-value">{{ Math.round(speedStore.currentSpeed * 10) / 10 }}</span>
        <span class="speed-unit">{{ speedStore.displayUnit }}</span>
      </div>
      <div class="target">
        0-{{ speedStore.targetSpeedInCurrentUnit }} {{ speedStore.displayUnit }}
      </div>
      <div class="distance">
        {{ speedStore.totalDistance < 1000 
          ? `${speedStore.totalDistance.toFixed(1)}m` 
          : `${(speedStore.totalDistance / 1000).toFixed(2)}km` }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.speed-display-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
}

.speed-display {
  margin-top: 40px;
  text-align: center;
}

.current-speed {
  display: flex;
  justify-content: center;
  align-items: baseline;
}

.speed-value {
  font-size: 6rem;
  font-weight: 700;
  line-height: 1;
  color: var(--tesla-white);
}

.speed-unit {
  font-size: 2rem;
  margin-left: 8px;
  color: var(--tesla-light-gray);
}

.target {
  font-size: 1.5rem;
  margin-top: 8px;
  color: var(--tesla-light-gray);
}

.distance {
  font-size: 1.2rem;
  margin-top: 8px;
  color: var(--tesla-light-gray);
  font-weight: 500;
}

@media (max-height: 700px) {
  .speed-value {
    font-size: 4rem;
  }
  
  .speed-unit {
    font-size: 1.5rem;
  }
}
</style>