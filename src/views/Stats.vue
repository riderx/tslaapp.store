<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Activity, Car, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import TeslaShell from '@/components/TeslaShell.vue'
import { teslaApi, type TeslaStats } from '@/api/teslaApi'
import { useTeslaStore } from '@/stores/teslaStore'
import { fmt, fmtDuration, fmtWhen, useTeslaUnits } from '@/tesla/units'

const tesla = useTeslaStore()
const { vehicle } = storeToRefs(tesla)
const { dist, speed, distUnit, speedUnit, effUnit, eff } = useTeslaUnits()

const periods = [7, 30, 90, 365]
const days = ref(30)
const stats = ref<TeslaStats | null>(null)
const loading = ref(false)
const error = ref('')
const tab = ref<'drives' | 'charges'>('drives')

async function load() {
  const vin = vehicle.value?.vin
  if (!vin) return
  loading.value = true
  error.value = ''
  try {
    stats.value = await teslaApi.stats(vin, days.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load stats'
  } finally {
    loading.value = false
  }
}

watch([() => vehicle.value?.vin, days], load, { immediate: true })

const t = computed(() => stats.value?.totals)
const empty = computed(() => stats.value && !stats.value.drives.length && !stats.value.charges.length)

// Daily distance bars; long windows are grouped by week to stay readable.
const bars = computed(() => {
  const daily = stats.value?.daily || []
  const group = daily.length > 60 ? 7 : 1
  const out: { label: string; distance: number; charged: number }[] = []
  for (let i = 0; i < daily.length; i += group) {
    const slice = daily.slice(i, i + group)
    out.push({
      label: slice[0].day.slice(5),
      distance: slice.reduce((s, d) => s + d.distance, 0),
      charged: slice.reduce((s, d) => s + d.charged, 0),
    })
  }
  return out
})
const maxBar = computed(() => Math.max(1, ...bars.value.map((b) => b.distance)))

const batteryPath = computed(() => {
  const pts = stats.value?.battery || []
  if (pts.length < 2) return ''
  const t0 = pts[0].t
  const span = Math.max(1, pts[pts.length - 1].t - t0)
  return pts
    .map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / span) * 100).toFixed(2)},${(100 - p.level).toFixed(2)}`)
    .join(' ')
})

const driveEff = (d: { distance: number; energy: number }) =>
  d.distance > 0.5 ? eff((d.energy * 1000) / d.distance) : null
</script>

<template>
  <TeslaShell title="Stats" :icon="Activity">
    <nav class="periods">
      <button v-for="p in periods" :key="p" :class="{ active: days === p }" @click="days = p">
        {{ p === 365 ? '1 year' : `${p} days` }}
      </button>
    </nav>

    <p v-if="error" class="notice">{{ error }}</p>
    <div v-if="loading && !stats" class="card muted">Loading stats…</div>

    <div v-if="empty" class="card muted info">
      No drives or charges logged yet. tslap checks your car in the background — go for a drive or plug in and
      sessions appear here. Keep Live Data open while driving for the most precise log.
    </div>

    <template v-if="stats && t">
      <div class="tiles">
        <div class="card tile">
          <div class="label">Distance</div>
          <div class="big">{{ fmt(dist(t.distance)) }}<small> {{ distUnit }}</small></div>
          <div class="sub">{{ t.drives }} drives · {{ fmtDuration(t.driveTimeMs) }}</div>
        </div>
        <div class="card tile">
          <div class="label">Efficiency</div>
          <div class="big">{{ fmt(eff(t.whPerMile)) }}<small> {{ effUnit }}</small></div>
          <div class="sub">{{ fmt(t.energy, 1) }} kWh used (est.)</div>
        </div>
        <div class="card tile">
          <div class="label">Charged</div>
          <div class="big">{{ fmt(t.charged, 1) }}<small> kWh</small></div>
          <div class="sub">
            {{ t.charges }} sessions · {{ t.charged > 0 ? fmt((t.fastCharged / t.charged) * 100) : 0 }}% fast
          </div>
        </div>
        <div class="card tile">
          <div class="label">Top speed</div>
          <div class="big">{{ fmt(speed(t.maxSpeed)) }}<small> {{ speedUnit }}</small></div>
          <div class="sub">
            Pack {{ fmt(stats.packKwh, 1) }} kWh {{ stats.packLearned ? '(learned)' : '(estimate)' }}
          </div>
        </div>
      </div>

      <section class="card chart">
        <div class="label">Distance per {{ bars.length < (stats.daily.length) ? 'week' : 'day' }}</div>
        <div class="bars">
          <div v-for="b in bars" :key="b.label" class="bar-col" :title="`${b.label}: ${fmt(dist(b.distance), 1)} ${distUnit}`">
            <div class="bar" :style="{ height: (b.distance / maxBar) * 100 + '%' }" />
            <div v-if="b.charged > 0" class="charge-dot" title="Charged" />
          </div>
        </div>
        <div class="axis">
          <span>{{ bars[0]?.label }}</span>
          <span>{{ bars[bars.length - 1]?.label }}</span>
        </div>
      </section>

      <section v-if="batteryPath" class="card chart">
        <div class="label">Battery level</div>
        <svg class="line" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="0" y1="20" x2="100" y2="20" class="grid" />
          <line x1="0" y1="80" x2="100" y2="80" class="grid" />
          <path :d="batteryPath" />
        </svg>
        <div class="axis"><span>{{ fmtWhen(stats.battery[0].t) }}</span><span>now</span></div>
      </section>

      <nav class="tabs">
        <button :class="{ active: tab === 'drives' }" @click="tab = 'drives'"><Car class="icon-xs" /> Drives</button>
        <button :class="{ active: tab === 'charges' }" @click="tab = 'charges'"><Zap class="icon-xs" /> Charges</button>
      </nav>

      <section class="card list">
        <template v-if="tab === 'drives'">
          <div v-if="!stats.drives.length" class="muted">No drives in this period.</div>
          <div v-for="d in stats.drives" :key="d.id" class="item">
            <div>
              <div class="name">{{ fmtWhen(d.start) }} <span v-if="d.open" class="live">LIVE</span></div>
              <div class="sub">
                {{ fmtDuration(d.end - d.start) }} · {{ fmt(d.startLevel) }}% → {{ fmt(d.endLevel) }}% · max
                {{ fmt(speed(d.maxSpeed)) }} {{ speedUnit }}
              </div>
            </div>
            <div class="right">
              <div class="name">{{ fmt(dist(d.distance), 1) }} {{ distUnit }}</div>
              <div class="sub">{{ fmt(driveEff(d)) }} {{ effUnit }}</div>
            </div>
          </div>
        </template>
        <template v-else>
          <div v-if="!stats.charges.length" class="muted">No charging sessions in this period.</div>
          <div v-for="c in stats.charges" :key="c.id" class="item">
            <div>
              <div class="name">
                {{ fmtWhen(c.start) }} <span v-if="c.open" class="live">CHARGING</span>
                <span v-if="c.fast" class="fast">DC</span>
              </div>
              <div class="sub">
                {{ fmtDuration(c.end - c.start) }} · {{ fmt(c.startLevel) }}% → {{ fmt(c.endLevel) }}% · peak
                {{ fmt(c.maxPower) }} kW
              </div>
            </div>
            <div class="right">
              <div class="name">+{{ fmt(c.energy, 1) }} kWh</div>
            </div>
          </div>
        </template>
      </section>
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
.muted { color: #888; font-size: 0.9rem; }
.info { margin-bottom: 0.9rem; line-height: 1.5; }
.notice { color: #fca5a5; margin-bottom: 0.75rem; font-size: 0.9rem; }
.periods, .tabs { display: flex; gap: 0.4rem; margin-bottom: 0.9rem; }
.periods button, .tabs button {
  background: #141414;
  border: 1px solid #2a2a2a;
  color: #aaa;
  padding: 0.55rem 0.9rem;
  border-radius: 0.6rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.periods button.active, .tabs button.active { color: #fff; border-color: #e82127; background: #1a0d0e; }
.tabs { margin-top: 0.9rem; }
.label { color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.4rem; }
.big { font-size: 1.9rem; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.big small { font-size: 0.85rem; color: #888; font-weight: 400; }
.sub { color: #999; font-size: 0.8rem; margin-top: 0.3rem; }
.name { font-weight: 600; }
.icon-xs { width: 0.9rem; height: 0.9rem; }
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 0.9rem;
  margin-bottom: 0.9rem;
}
.chart { margin-bottom: 0.9rem; }
.bars { display: flex; align-items: flex-end; gap: 3px; height: 9rem; }
.bar-col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative; }
.bar { width: 100%; background: #e82127; border-radius: 3px 3px 0 0; min-height: 1px; }
.charge-dot { position: absolute; bottom: -9px; width: 5px; height: 5px; border-radius: 50%; background: #22c55e; }
.axis { display: flex; justify-content: space-between; color: #666; font-size: 0.7rem; margin-top: 0.8rem; }
.line { width: 100%; height: 8rem; }
.line path { fill: none; stroke: #22c55e; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.line .grid { stroke: #2a2a2a; stroke-width: 1; vector-effect: non-scaling-stroke; stroke-dasharray: 3 3; }
.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #222;
}
.item:last-child { border-bottom: none; }
.right { text-align: right; white-space: nowrap; }
.live, .fast {
  font-size: 0.65rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.3rem;
  margin-left: 0.3rem;
  letter-spacing: 0.06em;
}
.live { background: #14532d; color: #4ade80; }
.fast { background: #3b2a05; color: #fbbf24; }
</style>
