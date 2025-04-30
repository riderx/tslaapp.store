<script setup lang="ts">
import { useSpeedStore } from '../stores/speedStore'

const speedStore = useSpeedStore()
</script>

<template>
  <div class="unit-toggle">
    <button 
      class="toggle-btn" 
      :class="{ active: !speedStore.isMetric }"
      @click="speedStore.isMetric = false">
      MPH
    </button>
    <button 
      class="toggle-btn" 
      :class="{ active: speedStore.isMetric }"
      @click="speedStore.isMetric = true">
      KM/H
    </button>
  </div>
</template>

<style scoped>
.unit-toggle {
  display: flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.toggle-btn {
  background: transparent;
  border: none;
  color: var(--tesla-light-gray);
  padding: 8px 16px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: auto;
}

.toggle-btn.active {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--tesla-white);
}

.toggle-btn:hover:not(.active) {
  background-color: rgba(255, 255, 255, 0.05);
}
</style>