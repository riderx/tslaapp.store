<script setup lang="ts">
import { useSpeedStore } from '../stores/speedStore'
import { computed } from 'vue'

const speedStore = useSpeedStore()

const formatDate = (isoString: string) => {
  return new Date(isoString).toLocaleString()
}

const formatSpeed = (speed: number, isMetric: boolean) => {
  return `${speed.toFixed(1)} ${isMetric ? 'km/h' : 'mph'}`
}
</script>

<template>
  <div class="history-panel">
    <div class="history-header">
      <h2>Test History</h2>
      <button 
        v-if="speedStore.testHistory.length > 0"
        class="clear-all-btn" 
        @click="speedStore.clearAllTestResults()">
        Clear All
      </button>
    </div>
    
    <div class="history-list">
      <div v-for="test in speedStore.testHistory" :key="test.id" class="history-item">
        <div class="history-item-header">
          <span class="history-time">{{ test.time }}s</span>
          <button class="delete-btn" @click="speedStore.deleteTestResult(test.id)">×</button>
        </div>
        
        <div class="history-details">
          <div class="detail-row">
            <span>Max Speed:</span>
            <span>{{ formatSpeed(test.maxSpeed, test.isMetric) }}</span>
          </div>
          <div class="detail-row">
            <span>Target:</span>
            <span>{{ formatSpeed(test.targetSpeed, test.isMetric) }}</span>
          </div>
          <div class="detail-row">
            <span>Date:</span>
            <span>{{ formatDate(test.date) }}</span>
          </div>
        </div>
      </div>
      
      <div v-if="speedStore.testHistory.length === 0" class="no-history">
        No tests recorded yet
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-panel {
  height: 100%;
  background-color: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
}

.history-header {
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-header h2 {
  font-size: 1.2rem;
  margin: 0;
}

.clear-all-btn {
  background: none;
  border: none;
  color: var(--tesla-light-gray);
  font-size: 0.9rem;
  cursor: pointer;
  padding: 4px 8px;
  min-width: auto;
  transition: color 0.2s ease;
}

.clear-all-btn:hover {
  color: var(--tesla-red);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.history-item {
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  margin-bottom: 16px;
  overflow: hidden;
}

.history-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background-color: rgba(255, 255, 255, 0.05);
}

.history-time {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--tesla-red);
}

.delete-btn {
  background: none;
  border: none;
  color: var(--tesla-light-gray);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 4px 8px;
  min-width: auto;
}

.delete-btn:hover {
  color: var(--tesla-red);
}

.history-details {
  padding: 12px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--tesla-light-gray);
  font-size: 0.9rem;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.no-history {
  text-align: center;
  color: var(--tesla-light-gray);
  padding: 32px;
}
</style>