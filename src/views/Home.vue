<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Activity, Gauge, Users, Zap, Volume2 } from 'lucide-vue-next'

const router = useRouter()

const apps = [
  {
    id: "speedtest",
    name: "Speedtest",
    icon: Gauge,
    available: true,
    route: '/speed-test'
  },
  {
    id: "carsound",
    name: "Car Sound",
    icon: Volume2,
    available: true,
    route: '/car-sound'
  },
  {
    id: "stats",
    name: "Stats",
    icon: Activity,
    available: false,
    comingSoon: true,
  },
  {
    id: "livedata",
    name: "Live Data",
    icon: Zap,
    available: false,
    comingSoon: true,
  },
  {
    id: "friends",
    name: "Friends",
    icon: Users,
    available: false,
    comingSoon: true,
  },
]

const time = ref(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))

// Update time every minute
let intervalId: number
onMounted(() => {
  intervalId = setInterval(() => {
    time.value = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }, 60000)
})

onUnmounted(() => {
  clearInterval(intervalId)
})

const handleAppClick = (appId: string) => {
  const app = apps.find((a) => a.id === appId)
  if (app?.available && app.route) {
    router.push(app.route)
  }
}
</script>

<template>
  <div class="container">
    <div class="header">
      <div class="logo-container">
        <svg class="tesla-logo" viewBox="0 0 342 35" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0 .1a9.7 9.7 0 0 0 7 7h11l.5.1v27.6h6.8V7.3L26 7h11a9.8 9.8 0 0 0 7-7H0zm238.6 0h-6.8v34.8H263a9.7 9.7 0 0 0 6-6.8h-30.3V0zm-52.3 6.8c3.6-1 6.6-3.8 7.4-6.9l-38.1.1v20.6h31.1v7.2h-24.4a13.6 13.6 0 0 0-8.7 7h39.9v-21h-31.2v-7h24zm116.2 28h6.7v-14h24.6v14h6.7v-21h-38zM85.3 7h26a9.6 9.6 0 0 0 7.1-7H78.3a9.6 9.6 0 0 0 7 7zm0 13.8h26a9.6 9.6 0 0 0 7.1-7H78.3a9.6 9.6 0 0 0 7 7zm0 14.1h26a9.6 9.6 0 0 0 7.1-7H78.3a9.6 9.6 0 0 0 7 7zM308.5 7h26a9.6 9.6 0 0 0 7-7h-40a9.6 9.6 0 0 0 7 7z"
            fill="currentColor"
          />
        </svg>
        <h1 class="site-title">tslap.store</h1>
      </div>
      <div class="time">{{ time }}</div>
    </div>

    <div class="app-grid">
      <div 
        v-for="app in apps"
        :key="app.id"
        class="app-item"
        :class="{ 'unavailable': !app.available }"
        @click="app.available && handleAppClick(app.id)"
      >
        <component :is="app.icon" class="app-icon" style="width: 3rem; height: 3rem;" />
        <div class="app-name">{{ app.name }}</div>
        <div v-if="app.comingSoon" class="coming-soon">COMING SOON</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
:root {
  --background: #000000;
  --foreground: #ffffff;
  --card-bg: #1a1a1a;
  --muted-text: #a0a0a0;
  --red: #e82127;
}

.container {
  padding: 1.5rem;
  background-color: var(--background);
  color: var(--foreground);
  min-height: 100vh;
}

@media (min-width: 768px) {
  .container {
    padding: 2rem;
  }
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2rem;
}

.logo-container {
  display: flex;
  align-items: center;
}

.tesla-logo {
  height: 1.5rem;
  width: auto;
  margin-right: 0.5rem;
}

.site-title {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.time {
  font-size: 0.875rem;
  font-weight: 300;
  color: var(--muted-text);
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
}

@media (min-width: 768px) {
  .app-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.app-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1rem;
  border-radius: 0.75rem;
  background-color: var(--card-bg);
  cursor: pointer;
}

.app-item.unavailable {
  opacity: 0.6;
  cursor: default;
}

.app-icon {
  margin-bottom: 0.75rem;
  color: var(--foreground);
}

.app-name {
  font-size: 0.875rem;
  font-weight: 500;
}

.coming-soon {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--red);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
</style>
