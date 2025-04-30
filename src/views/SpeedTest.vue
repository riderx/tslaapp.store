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
  <main class="speed-test">
    <TopBar />
    
    <PermissionRequest v-if="speedStore.permissionDenied" />
    
    <div v-else class="content-grid">
      <SettingsMenu class="settings-section" />
      <SpeedDisplay class="speed-section" />
      <TestHistory class="history-section" />
      <Countdown />
    </div>
    
    <BottomBar />
  </main>
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
  min-height: 0;
}

.settings-section {
  grid-column: 1;
  min-height: 0;
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
  min-height: 0;
}

@media (max-width: 600px) {
  .content-grid {
    grid-template-columns: 200px 1fr 280px;
  }
}

</style>
