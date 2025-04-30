<script setup lang="ts">
import { useRouter } from 'vue-router'
import UnitToggle from './UnitToggle.vue'

const router = useRouter()

const goHome = () => {
  router.push('/')
}
</script>

<template>
  <header class="top-bar">
    <div class="tesla-logo" @click="goHome">
      <img src="https://www.pngmart.com/files/22/Tesla-Logo-PNG-Transparent.png" alt="Tesla" width="120">
    </div>
    <h1>Tesla Speed Test</h1>
    <UnitToggle />
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  z-index: 10;
}

.tesla-logo {
  cursor: pointer;
}

.tesla-logo img {
  width: 40px;
  height: auto;
}

.top-bar h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0 auto 0 0;
  text-align: center;
  flex: 1;
  padding: 0 120px;
}

@media (max-width: 600px) {
  .top-bar h1 {
    font-size: 1.2rem;
    padding: 0 80px;
  }
  
  .tesla-logo img {
    width: 30px;
  }
}
</style>
