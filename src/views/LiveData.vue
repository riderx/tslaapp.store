<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BatteryCharging, Lock, LockOpen, Moon, Power, RotateCcw, Shield, Thermometer, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import TeslaShell from '@/components/TeslaShell.vue'
import { teslaApi, type VehicleData } from '@/api/teslaApi'
import { useTeslaStore } from '@/stores/teslaStore'
import { ago, fmt, useTeslaUnits } from '@/tesla/units'

const tesla = useTeslaStore()
const { vehicle } = storeToRefs(tesla)
const { metric, adoptCarUnits, dist, speed, distUnit, speedUnit, effUnit, eff } = useTeslaUnits()

const data = ref<VehicleData | null>(null)
const state = ref<string>('')
const at = ref<number | null>(null)
const error = ref('')
const waking = ref(false)
const now = ref(Date.now())

// Trip meter for the time this screen is open
const trip = ref({ startOdo: null as number | null, odo: null as number | null, kwh: 0, lastTs: 0 })

let timer: number | null = null
let clock: number | null = null

const drive = computed(() => data.value?.drive_state || {})
const charge = computed(() => data.value?.charge_state || {})
const climate = computed(() => data.value?.climate_state || {})
const vs = computed(() => data.value?.vehicle_state || {})

const gear = computed(() => drive.value.shift_state || 'P')
const driving = computed(() => ['D', 'R', 'N'].includes(drive.value.shift_state))
const charging = computed(() => ['Charging', 'Starting'].includes(charge.value.charging_state))
const pluggedIn = computed(() => charge.value.charging_state && charge.value.charging_state !== 'Disconnected')
const asleep = computed(() => state.value !== 'online')

const power = computed<number>(() => drive.value.power ?? 0)
const powerPct = computed(() => Math.min(100, (Math.abs(power.value) / (power.value < 0 ? 80 : 300)) * 100))

const tripDistance = computed(() =>
  trip.value.startOdo != null && trip.value.odo != null ? trip.value.odo - trip.value.startOdo : 0,
)
const tripEff = computed(() => (tripDistance.value > 0.2 ? (trip.value.kwh * 1000) / tripDistance.value : null))

function pressure(bar: number | null | undefined) {
  if (bar == null) return '—'
  return metric.value ? bar.toFixed(1) : (bar * 14.5038).toFixed(0)
}

function trackTrip(d: VehicleData, ts: number) {
  const odo = d.vehicle_state?.odometer
  if (odo != null) {
    if (trip.value.startOdo == null) trip.value.startOdo = odo
    trip.value.odo = odo
  }
  const p = d.drive_state?.power
  if (p != null && trip.value.lastTs && ts > trip.value.lastTs) {
    const hours = Math.min(ts - trip.value.lastTs, 60_000) / 3_600_000
    trip.value.kwh += p * hours
  }
  trip.value.lastTs = ts
}

function resetTrip() {
  trip.value = { startOdo: trip.value.odo, odo: trip.value.odo, kwh: 0, lastTs: trip.value.lastTs }
}

async function refresh() {
  const vin = vehicle.value?.vin
  if (!vin || document.hidden) return schedule()
  try {
    const res = await teslaApi.live(vin)
    state.value = res.state
    if (res.data) {
      if (res.state === 'online' && res.at && res.at !== at.value) trackTrip(res.data, res.at)
      data.value = res.data
      adoptCarUnits(res.data.gui_settings?.gui_distance_units)
    }
    at.value = res.at
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not reach the car'
  }
  schedule()
}

function schedule() {
  if (timer) clearTimeout(timer)
  // Fleet API calls are billed: go fast only when something is changing.
  const delay = asleep.value ? 60_000 : driving.value ? 3_000 : charging.value ? 10_000 : 15_000
  timer = window.setTimeout(refresh, delay)
}

async function wake() {
  const vin = vehicle.value?.vin
  if (!vin) return
  waking.value = true
  try {
    await teslaApi.wake(vin)
    // Waking takes ~10-30s; poll until it reports online.
    for (let i = 0; i < 8 && asleep.value; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      await refresh()
    }
  } finally {
    waking.value = false
  }
}

watch(
  () => vehicle.value?.vin,
  (vin) => {
    data.value = null
    state.value = ''
    trip.value = { startOdo: null, odo: null, kwh: 0, lastTs: 0 }
    if (vin) refresh()
  },
  { immediate: true },
)

function onVisible() {
  if (!document.hidden) refresh()
}

onMounted(() => {
  clock = window.setInterval(() => (now.value = Date.now()), 1000)
  document.addEventListener('visibilitychange', onVisible)
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
  if (clock) clearInterval(clock)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<template>
  <TeslaShell title="Live Data" :icon="Zap">
    <p v-if="error" class="notice">{{ error }}</p>

    <div v-if="asleep && state" class="card sleep">
      <Moon class="sleep-icon" />
      <div class="grow">
        <div class="name">Car is {{ state }}</div>
        <div class="sub">Last data {{ ago(at) }} · checking every minute without waking it</div>
      </div>
      <button class="primary" :disabled="waking" @click="wake">
        <Power class="icon-sm" /> {{ waking ? 'Waking…' : 'Wake car' }}
      </button>
    </div>

    <div v-if="!data && !state" class="card muted">Connecting to car…</div>

    <template v-if="data">
      <section class="hero card" :class="{ stale: asleep }">
        <div class="speed-block">
          <div class="speed">{{ fmt(speed(drive.speed ?? 0)) }}</div>
          <div class="unit">{{ speedUnit }}</div>
        </div>
        <div class="gears">
          <span v-for="g in ['P', 'R', 'N', 'D']" :key="g" :class="{ on: gear === g }">{{ g }}</span>
        </div>
        <div class="power">
          <div class="label">Power</div>
          <div class="power-value" :class="{ regen: power < 0 }">{{ fmt(power) }} <small>kW</small></div>
          <div class="power-bar">
            <div class="half left"><div v-if="power < 0" class="fill regen" :style="{ width: powerPct + '%' }" /></div>
            <div class="half right"><div v-if="power > 0" class="fill" :style="{ width: powerPct + '%' }" /></div>
          </div>
        </div>
      </section>

      <div class="grid">
        <section class="card">
          <div class="label"><BatteryCharging class="icon-xs" /> Battery</div>
          <div class="big">{{ fmt(charge.battery_level) }}<small>%</small></div>
          <div class="battery">
            <div class="battery-fill" :class="{ low: (charge.battery_level ?? 0) < 20, charging }" :style="{ width: (charge.battery_level ?? 0) + '%' }" />
            <div class="limit" :style="{ left: (charge.charge_limit_soc ?? 100) + '%' }" />
          </div>
          <div class="sub">
            {{ fmt(dist(charge.battery_range)) }} {{ distUnit }} range · limit {{ fmt(charge.charge_limit_soc) }}%
          </div>
        </section>

        <section v-if="pluggedIn" class="card" :class="{ active: charging }">
          <div class="label"><Zap class="icon-xs" /> {{ charge.charging_state }}</div>
          <div class="big">{{ fmt(charge.charger_power) }}<small> kW</small></div>
          <div class="sub">
            {{ fmt(charge.charger_voltage) }} V · {{ fmt(charge.charger_actual_current) }} A
            <template v-if="charge.fast_charger_present"> · {{ charge.fast_charger_brand || 'DC' }}</template>
          </div>
          <div class="sub">
            +{{ fmt(charge.charge_energy_added, 1) }} kWh
            <template v-if="charging && charge.time_to_full_charge"> · full in {{ fmt(charge.time_to_full_charge * 60) }} min</template>
          </div>
        </section>

        <section class="card">
          <div class="label">This session <button class="reset" title="Reset" @click="resetTrip"><RotateCcw class="icon-xs" /></button></div>
          <div class="big">{{ fmt(dist(tripDistance), 1) }}<small> {{ distUnit }}</small></div>
          <div class="sub">{{ fmt(trip.kwh, 2) }} kWh · {{ fmt(eff(tripEff)) }} {{ effUnit }}</div>
        </section>

        <section class="card">
          <div class="label"><Thermometer class="icon-xs" /> Climate</div>
          <div class="big">{{ fmt(climate.inside_temp, 1) }}<small>°C in</small></div>
          <div class="sub">
            {{ fmt(climate.outside_temp, 1) }}°C outside · HVAC {{ climate.is_climate_on ? 'on' : 'off' }}
            <template v-if="climate.is_climate_on"> · set {{ fmt(climate.driver_temp_setting, 1) }}°C</template>
          </div>
        </section>

        <section class="card">
          <div class="label">Tires ({{ metric ? 'bar' : 'psi' }})</div>
          <div class="tires">
            <span>{{ pressure(vs.tpms_pressure_fl) }}</span>
            <span>{{ pressure(vs.tpms_pressure_fr) }}</span>
            <span>{{ pressure(vs.tpms_pressure_rl) }}</span>
            <span>{{ pressure(vs.tpms_pressure_rr) }}</span>
          </div>
        </section>

        <section class="card">
          <div class="label">Vehicle</div>
          <div class="big">{{ fmt(dist(vs.odometer)) }}<small> {{ distUnit }}</small></div>
          <div class="flags">
            <span><component :is="vs.locked ? Lock : LockOpen" class="icon-xs" /> {{ vs.locked ? 'Locked' : 'Unlocked' }}</span>
            <span :class="{ on: vs.sentry_mode }"><Shield class="icon-xs" /> Sentry {{ vs.sentry_mode ? 'on' : 'off' }}</span>
          </div>
          <div class="sub">Software {{ vs.car_version?.split(' ')[0] || '—' }}</div>
        </section>
      </div>

      <p class="updated">Updated {{ at ? ago(at) : '—' }}<template v-if="now && at && !asleep"> · refreshing {{ driving ? 'every 3 s' : charging ? 'every 10 s' : 'every 15 s' }}</template></p>
    </template>
  </TeslaShell>
</template>

<style scoped>
.card {
  background: rgba(20, 20, 20, 0.9);
  border: 1px solid #222;
  border-radius: 0.9rem;
  padding: 1.1rem;
}
.card.active { border-color: #16a34a; }
.muted { color: #888; }
.notice { color: #fca5a5; margin-bottom: 0.75rem; font-size: 0.9rem; }
.label {
  color: #888;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.4rem;
}
.big { font-size: 2rem; font-weight: 600; line-height: 1.1; }
.big small { font-size: 0.9rem; color: #888; font-weight: 400; margin-left: 0.15rem; }
.sub { color: #999; font-size: 0.8rem; margin-top: 0.35rem; }
.name { font-weight: 600; text-transform: capitalize; }
.icon-xs { width: 0.85rem; height: 0.85rem; }
.icon-sm { width: 1rem; height: 1rem; }
.grow { flex: 1; }
.primary {
  background: #e82127;
  color: #fff;
  border: none;
  border-radius: 0.5rem;
  padding: 0.7rem 1rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.primary:disabled { opacity: 0.5; }

.sleep { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.9rem; }
.sleep-icon { width: 2rem; height: 2rem; color: #818cf8; }

.hero {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 2rem;
  margin-bottom: 0.9rem;
}
.hero.stale { opacity: 0.55; }
.speed-block { text-align: center; min-width: 7rem; }
.speed { font-size: 4.5rem; font-weight: 300; line-height: 1; font-variant-numeric: tabular-nums; }
.unit { color: #888; font-size: 0.9rem; }
.gears { display: flex; gap: 0.6rem; font-size: 1.3rem; font-weight: 600; color: #444; }
.gears .on { color: #fff; }
.power-value { font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.power-value.regen { color: #4ade80; }
.power-value small { font-size: 0.8rem; color: #888; }
.power-bar { display: grid; grid-template-columns: 1fr 3fr; gap: 2px; height: 0.5rem; margin-top: 0.5rem; }
.half { background: #1c1c1c; border-radius: 999px; overflow: hidden; display: flex; }
.half.left { justify-content: flex-end; }
.fill { background: #e82127; height: 100%; transition: width 0.4s; }
.fill.regen { background: #22c55e; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.9rem;
}
.battery { position: relative; height: 0.7rem; background: #1c1c1c; border-radius: 999px; margin-top: 0.6rem; }
.battery-fill { height: 100%; border-radius: 999px; background: #e5e5e5; transition: width 0.4s; }
.battery-fill.low { background: #e82127; }
.battery-fill.charging { background: #22c55e; }
.limit { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #888; }
.reset { background: none; border: none; color: #888; cursor: pointer; margin-left: auto; }
.tires {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem 1.5rem;
  font-size: 1.4rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  max-width: 10rem;
}
.flags { display: flex; gap: 1rem; color: #bbb; font-size: 0.8rem; margin-top: 0.4rem; }
.flags span { display: inline-flex; align-items: center; gap: 0.3rem; }
.flags .on { color: #fbbf24; }
.updated { color: #666; font-size: 0.75rem; margin-top: 0.9rem; }

@media (max-width: 640px) {
  .hero { grid-template-columns: 1fr; gap: 1rem; text-align: center; }
  .gears { justify-content: center; }
}
</style>
