<script setup lang="ts">
import { onMounted, ref, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Link2, RefreshCw } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useFriendsStore } from '@/stores/friendsStore'
import { useTeslaStore } from '@/stores/teslaStore'
import { useTeslaUnits } from '@/tesla/units'

defineProps<{ title: string; icon: Component }>()

const router = useRouter()
const route = useRoute()
const friendsStore = useFriendsStore()
const tesla = useTeslaStore()
const { user } = storeToRefs(friendsStore)
const { loaded, configured, connected, vehicles, vehicle, selectedVin, error } = storeToRefs(tesla)
const { metric, setMetric } = useTeslaUnits()

const nameInput = ref('')
const busy = ref(false)
const notice = ref('')

const callbackNotice: Record<string, string> = {
  connected: 'Tesla connected',
  expired: 'Login took too long — try again',
  error: 'Tesla login failed — try again',
  access_denied: 'Access was denied on the Tesla page',
}

onMounted(async () => {
  const q = route.query.tesla
  if (typeof q === 'string') {
    notice.value = callbackNotice[q] || `Tesla: ${q}`
    router.replace({ query: {} })
  }
  if (!user.value) await friendsStore.bootstrap()
  await tesla.load()
})

async function register() {
  busy.value = true
  notice.value = ''
  try {
    await friendsStore.register(nameInput.value.trim())
    await tesla.load()
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Could not create account'
  } finally {
    busy.value = false
  }
}

async function sync() {
  busy.value = true
  try {
    await tesla.sync()
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Could not load vehicles'
  } finally {
    busy.value = false
  }
}

async function disconnect() {
  if (!confirm('Disconnect Tesla and delete all logged drives and charges?')) return
  await tesla.disconnect()
}
</script>

<template>
  <div class="page">
    <header class="header">
      <button class="back" @click="router.push('/')"><ArrowLeft class="icon" /> Home</button>
      <div class="title-wrap">
        <component :is="icon" class="icon" />
        <h1>{{ title }}</h1>
      </div>
      <div class="units">
        <button :class="{ on: !metric }" @click="setMetric(false)">MI</button>
        <button :class="{ on: metric }" @click="setMetric(true)">KM</button>
      </div>
    </header>

    <p v-if="notice || error" class="notice">{{ notice || error }}</p>

    <div v-if="!loaded" class="card muted">Loading…</div>

    <div v-else-if="!user" class="card setup">
      <h2>Pick a driver name</h2>
      <p>Your tslap account keeps your Tesla link and history. Same account as Friends.</p>
      <input v-model="nameInput" maxlength="32" placeholder="Your name" @keyup.enter="register" />
      <button class="primary" :disabled="busy || nameInput.trim().length < 2" @click="register">Continue</button>
    </div>

    <div v-else-if="!configured" class="card setup">
      <h2>Tesla connection unavailable</h2>
      <p>The server has no Tesla Fleet API app configured yet (TESLA_CLIENT_ID / TESLA_CLIENT_SECRET).</p>
    </div>

    <div v-else-if="!connected" class="card setup">
      <h2>Connect your Tesla</h2>
      <p>
        Sign in on tesla.com to share read-only vehicle data. tslap logs drives and charges in the background
        for stats — like TezLab or TeslaMate. No commands are ever sent to your car.
      </p>
      <ul class="perks">
        <li>Live speed, power, battery, range, temps and tires</li>
        <li>Drive log with distance, energy and efficiency</li>
        <li>Charging sessions, kWh added and battery history</li>
      </ul>
      <button class="primary" @click="tesla.connect()"><Link2 class="icon-sm" /> Connect Tesla account</button>
    </div>

    <div v-else-if="!vehicles.length" class="card setup">
      <h2>No vehicles found</h2>
      <p>Your Tesla account is linked but no car was shared. Re-run the login and allow vehicle access.</p>
      <div class="row">
        <button class="primary" :disabled="busy" @click="sync"><RefreshCw class="icon-sm" /> Refresh</button>
        <button class="ghost" @click="tesla.connect()">Reconnect</button>
      </div>
    </div>

    <template v-else-if="vehicle">
      <div v-if="vehicles.length > 1" class="vehicle-picks">
        <button
          v-for="v in vehicles"
          :key="v.vin"
          class="chip"
          :class="{ on: v.vin === vehicle.vin }"
          @click="selectedVin = v.vin"
        >
          {{ v.name }}
        </button>
      </div>
      <slot :vehicle="vehicle" />
      <footer class="foot">
        <span>{{ vehicle.name }} · {{ vehicle.vin }}</span>
        <button class="link" @click="sync">Refresh vehicles</button>
        <button class="link" @click="disconnect">Disconnect Tesla</button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: radial-gradient(1200px 600px at 10% -10%, #2a1012 0%, #000 55%);
  color: #fff;
  padding: 1.25rem;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}
.back {
  background: transparent;
  border: none;
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.title-wrap { display: flex; align-items: center; gap: 0.5rem; }
.title-wrap h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.icon { width: 1.15rem; height: 1.15rem; }
.icon-sm { width: 1rem; height: 1rem; }
.units { display: flex; border: 1px solid #333; border-radius: 0.5rem; overflow: hidden; }
.units button { background: transparent; border: none; color: #888; padding: 0.4rem 0.7rem; font-size: 0.75rem; cursor: pointer; }
.units button.on { background: #1a0d0e; color: #fff; }
.card {
  background: rgba(20, 20, 20, 0.9);
  border: 1px solid #222;
  border-radius: 0.9rem;
  padding: 1.1rem;
}
.muted { color: #888; }
.setup { max-width: 34rem; }
.setup h2 { font-size: 1.4rem; margin-bottom: 0.4rem; }
.setup p { color: #9a9a9a; font-size: 0.9rem; margin-bottom: 1rem; }
.perks { color: #ccc; font-size: 0.9rem; margin: 0 0 1.1rem 1.1rem; list-style: disc; line-height: 1.7; }
input {
  width: 100%;
  background: #0c0c0c;
  border: 1px solid #333;
  color: #fff;
  border-radius: 0.5rem;
  padding: 0.85rem 0.9rem;
  margin-bottom: 0.75rem;
}
.row { display: flex; gap: 0.5rem; }
.primary {
  background: #e82127;
  color: #fff;
  border: none;
  border-radius: 0.5rem;
  padding: 0.85rem 1rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.primary:disabled { opacity: 0.5; }
.ghost {
  background: #1c1c1c;
  border: 1px solid #333;
  color: #fff;
  border-radius: 0.5rem;
  padding: 0.85rem 1rem;
  cursor: pointer;
}
.vehicle-picks { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.9rem; }
.chip {
  background: #1a1a1a;
  border: 1px solid #333;
  color: #ccc;
  border-radius: 999px;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
}
.chip.on { border-color: #e82127; color: #fff; background: #2a1214; }
.notice { color: #fca5a5; margin: 0 0 0.75rem; font-size: 0.9rem; }
.foot {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  color: #666;
  font-size: 0.75rem;
  margin-top: 1.5rem;
}
.link { background: none; border: none; color: #888; text-decoration: underline; cursor: pointer; font-size: 0.75rem; }
</style>
