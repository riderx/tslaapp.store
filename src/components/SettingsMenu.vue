<script setup lang="ts">
import { useSpeedStore } from '@/stores/speedStore'
import TopBar from '@/components/TopBar.vue'
import BottomBar from '@/components/BottomBar.vue'
import SettingsMenu from '@/components/SettingsMenu.vue'
import SpeedDisplay from '@/components/SpeedDisplay.vue'
import TestHistory from '@/components/TestHistory.vue'
import PermissionRequest from '@/components/PermissionRequest.vue'
import Countdown from '@/components/Countdown.vue'

const speedStore = useSpeedStore()
</script>

<template>
  <div class="settings-menu">
    <div class="menu-section">
      <h3>Test Type</h3>
      <button 
        v-for="type in speedStore.testTypes"
        :key="type.type"
        :class="['menu-btn', { active: speedStore.selectedTestType === type.type }]"
        @click="speedStore.selectedTestType = type.type">
        {{ type.label }}
      </button>
    </div>
    
    <div class="menu-section">
      <h3>Target</h3>
      <button 
        v-for="target in speedStore.currentTargets"
        :key="target.value"
        :class="['menu-btn', { active: speedStore.selectedTarget === target.value }]"
        @click="speedStore.selectedTarget = target.value">
        {{ target.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.speed-test {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  background-color: var(--tesla-dark);
  color: var(--tesla-white);
}

.content-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 240px 1fr 320px;
  gap: 24px;
  padding: 24px;
  height: 100%;
}

.settings-section {
  grid-column: 1;
}

.speed-section {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.history-section {
  grid-column: 3;
}

.menu-section {
  margin-bottom: 24px;
  flex-shrink: 0;
}

.menu-section h3 {
  font-size: 0.9rem;
  text-transform: uppercase;
  color: var(--tesla-light-gray);
  margin-bottom: 8px;
  padding-left: 8px;
}

.menu-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--tesla-white);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: auto;
  text-align: left;
  white-space: nowrap;
  display: block;
  width: 100%;
  margin-bottom: 8px;
}

.menu-btn:last-child {
  margin-bottom: 0;
}

.menu-btn.active {
  background: var(--tesla-red);
  border-color: var(--tesla-red);
}

@media (max-width: 600px) {
  .content-grid {
    grid-template-columns: 200px 1fr 280px;
  }
}
</style>