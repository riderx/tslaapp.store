<script setup lang="ts">
import { useSpeedStore } from '../stores/speedStore'

const speedStore = useSpeedStore()
</script>

<template>
  <div class="permission-container">
    <div class="permission-card">
      <h2>Location Permission Required</h2>
      
      <p>
        This speed test needs access to your device's location services to measure speed accurately.
        Please enable location services to continue.
      </p>
      
      <div class="instructions">
        <h3>How to enable location:</h3>
        <ul>
          <li>Check your browser settings</li>
          <li>Look for site permissions or privacy settings</li>
          <li>Allow location access for this site</li>
          <li>Refresh the page after enabling</li>
        </ul>
      </div>
      
      <button class="button-primary" @click="speedStore.requestGeolocationPermission()">
        Try Again
      </button>
    </div>
  </div>
</template>

<style scoped>
.permission-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
}

.permission-card {
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  padding: 32px;
  max-width: 500px;
  text-align: center;
}

h2 {
  font-size: 1.8rem;
  margin-bottom: 16px;
  color: var(--tesla-red);
}

p {
  font-size: 1.1rem;
  line-height: 1.5;
  margin-bottom: 24px;
  color: var(--tesla-white);
}

.instructions {
  text-align: left;
  margin-bottom: 32px;
  background-color: rgba(0, 0, 0, 0.2);
  padding: 16px;
  border-radius: 8px;
}

h3 {
  font-size: 1.2rem;
  margin-bottom: 8px;
  color: var(--tesla-white);
}

ul {
  margin-left: 24px;
}

li {
  margin-bottom: 8px;
  color: var(--tesla-light-gray);
}
</style>