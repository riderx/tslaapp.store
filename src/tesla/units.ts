import { computed, ref } from 'vue'

const KEY = 'tslap.tesla.metric'
const CAR_KEY = 'tslap.tesla.carMetric'
const KM_PER_MI = 1.609344

const stored = localStorage.getItem(KEY) ?? localStorage.getItem(CAR_KEY)
const metric = ref(stored != null ? stored === '1' : !navigator.language.startsWith('en-US'))

function setMetric(value: boolean, persist = true) {
  metric.value = value
  if (persist) localStorage.setItem(KEY, value ? '1' : '0')
}

/** Follow the car's own display units until the user picks explicitly. */
function adoptCarUnits(guiDistanceUnits?: string) {
  if (!guiDistanceUnits) return
  const carMetric = guiDistanceUnits.startsWith('km')
  localStorage.setItem(CAR_KEY, carMetric ? '1' : '0')
  if (localStorage.getItem(KEY) == null) metric.value = carMetric
}

/** Fleet API reports miles / mph; convert for display. */
export function useTeslaUnits() {
  const distUnit = computed(() => (metric.value ? 'km' : 'mi'))
  const speedUnit = computed(() => (metric.value ? 'km/h' : 'mph'))
  const effUnit = computed(() => (metric.value ? 'Wh/km' : 'Wh/mi'))
  const dist = (miles: number | null | undefined) => (miles == null ? null : metric.value ? miles * KM_PER_MI : miles)
  const speed = dist
  const eff = (whPerMile: number | null | undefined) =>
    whPerMile == null ? null : metric.value ? whPerMile / KM_PER_MI : whPerMile
  return { metric, setMetric, adoptCarUnits, distUnit, speedUnit, effUnit, dist, speed, eff }
}

export function fmt(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtDuration(ms: number) {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${String(m % 60).padStart(2, '0')}`
}

export function fmtWhen(ts: number) {
  const d = new Date(ts)
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function ago(ts: number | null | undefined) {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
