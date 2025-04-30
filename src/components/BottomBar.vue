<script setup lang="ts">
import { useSpeedStore } from '../stores/speedStore'

const speedStore = useSpeedStore()
</script>

<template>
  <footer class="control-panel">
    <button 
      :class="['button-primary', { 'running': speedStore.isRunning }]" 
      @click="speedStore.isRunning ? speedStore.resetTest() : speedStore.startTest()"
      >
      {{ speedStore.isRunning ? 'STOP' : 'START' }}
    </button>
    
    <button 
      class="button-secondary"
      @click="speedStore.resetTest()"
      :disabled="!speedStore.isRunning && speedStore.startTime === 0"
      v-if="!speedStore.isRunning">
      RESET
    </button>
  </footer>
</template>

<style scoped>
.control-panel {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 32px 16px;
  background-color: rgba(0, 0, 0, 0.3);
  position: relative;
  z-index: 1001;
}

.button-primary.running {
  background-color: #555;
  color: #ccc;
}

@media (max-width: 600px) {
  .control-panel {
    padding: 24px 16px;
  }
}
</style>