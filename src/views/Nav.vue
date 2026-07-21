<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import maplibregl, { type Map, type Marker, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  LocateFixed,
  Navigation,
  RotateCcw,
  Search,
  X,
} from 'lucide-vue-next'
import { searchPlaces } from '../nav/geocode'
import { fetchRoute } from '../nav/osrm'
import { formatDistance, formatDuration, formatEta } from '../nav/format'
import { computeProgress } from '../nav/geo'
import type { LatLng, PlaceResult, RouteResult } from '../nav/types'

const router = useRouter()

type Phase = 'search' | 'preview' | 'navigating'

const KYIV: LatLng = { lat: 50.4501, lng: 30.5234 }
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const mapEl = ref<HTMLElement | null>(null)
const phase = ref<Phase>('search')
const query = ref('')
const results = ref<PlaceResult[]>([])
const searching = ref(false)
const error = ref('')
const position = ref<LatLng | null>(KYIV)
const heading = ref<number | undefined>()
const destination = ref<PlaceResult | null>(null)
const route = ref<RouteResult | null>(null)
const loadingRoute = ref(false)
const follow = ref(true)

let map: Map | null = null
let locMarker: Marker | null = null
let destMarker: Marker | null = null
let watchId: number | null = null
let searchTimer: number | null = null
let rerouteBusy = false

const progress = computed(() => {
  if (!position.value || !route.value || phase.value !== 'navigating') return null
  return computeProgress(position.value, route.value, heading.value)
})

const maneuverIcon = computed(() => {
  const step = progress.value?.step
  if (!step) return ArrowUp
  if (step.type === 'arrive') return Flag
  const mod = step.modifier || ''
  if (mod === 'uturn') return RotateCcw
  if (mod.includes('left')) return mod.includes('sharp') || mod === 'left' ? ArrowLeft : CornerUpLeft
  if (mod.includes('right')) return mod.includes('sharp') || mod === 'right' ? ArrowRight : CornerUpRight
  return ArrowUp
})

function initMap() {
  if (!mapEl.value) return
  map = new maplibregl.Map({
    container: mapEl.value,
    style: STYLE,
    center: [KYIV.lng, KYIV.lat],
    zoom: 13,
    pitch: 0,
    attributionControl: { compact: true },
  })

  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')

  map.on('load', () => {
    map!.addSource('route', {
      type: 'geojson',
      data: emptyLine(),
    })
    map!.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      paint: {
        'line-color': '#1a73e8',
        'line-width': 12,
        'line-opacity': 0.25,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
    map!.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: {
        'line-color': '#1a73e8',
        'line-width': 7,
        'line-opacity': 1,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
  })

  map.on('dragstart', () => {
    if (phase.value === 'navigating') follow.value = false
  })
}

function emptyLine() {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: [] as [number, number][] },
  }
}

function setRouteLine(coords: LatLng[]) {
  const src = map?.getSource('route') as GeoJSONSource | undefined
  src?.setData({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: coords.map((c) => [c.lng, c.lat]),
    },
  })
}

function upsertLocMarker(pos: LatLng, bearingDeg?: number) {
  if (!map) return
  const el = document.createElement('div')
  el.className = 'nav-puck'
  el.innerHTML = `<div class="nav-puck-arrow" style="transform:rotate(${bearingDeg ?? 0}deg)"></div>`

  if (!locMarker) {
    locMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat([pos.lng, pos.lat])
      .addTo(map)
  } else {
    locMarker.setLngLat([pos.lng, pos.lat])
    const arrow = locMarker.getElement().querySelector('.nav-puck-arrow') as HTMLElement | null
    if (arrow && bearingDeg != null) arrow.style.transform = `rotate(${bearingDeg}deg)`
  }
}

function upsertDestMarker(pos: LatLng) {
  if (!map) return
  if (!destMarker) {
    const el = document.createElement('div')
    el.className = 'nav-dest'
    destMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([pos.lng, pos.lat])
      .addTo(map)
  } else {
    destMarker.setLngLat([pos.lng, pos.lat])
  }
}

function startGps() {
  if (!navigator.geolocation) {
    error.value = 'Geolocation not available in this browser'
    position.value = KYIV
    return
  }
  // Seed immediately so Start works while GPS warms up / is blocked
  if (!position.value) position.value = KYIV
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      position.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) {
        heading.value = pos.coords.heading
      }
    },
    () => {
      if (!position.value) {
        error.value = 'Location denied — using Kyiv. Enable GPS for turn-by-turn.'
        position.value = KYIV
      }
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
  )
}

watch(position, (pos) => {
  if (!pos || !map) return
  const brg = progress.value?.bearing ?? heading.value
  upsertLocMarker(pos, brg)

  if (phase.value === 'search' && !destination.value) {
    map.easeTo({ center: [pos.lng, pos.lat], duration: 500 })
  }

  if (phase.value === 'navigating' && route.value) {
    const p = computeProgress(pos, route.value, heading.value)
    if (follow.value) {
      map.easeTo({
        center: [pos.lng, pos.lat],
        bearing: p.bearing,
        pitch: 55,
        zoom: 16.5,
        duration: 800,
        essential: true,
      })
    }
    if (p.offRoute && !rerouteBusy && destination.value) {
      void reroute()
    }
    if (p.step.type === 'arrive' && p.distanceRemaining < 25) {
      // stay on arrive instruction
    }
  }
})

watch(query, (q) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  if (q.trim().length < 2) {
    results.value = []
    return
  }
  searchTimer = window.setTimeout(async () => {
    searching.value = true
    error.value = ''
    try {
      results.value = await searchPlaces(q, position.value ?? KYIV)
    } catch {
      error.value = 'Search failed — check network'
    } finally {
      searching.value = false
    }
  }, 280)
})

async function selectPlace(place: PlaceResult) {
  destination.value = place
  results.value = []
  query.value = place.name
  upsertDestMarker({ lat: place.lat, lng: place.lng })
  await buildRoute()
}

async function buildRoute() {
  if (!destination.value) return
  const from = position.value ?? KYIV
  loadingRoute.value = true
  error.value = ''
  try {
    const r = await fetchRoute(from, { lat: destination.value.lat, lng: destination.value.lng })
    route.value = r
    setRouteLine(r.geometry)
    phase.value = 'preview'
    fitRoute(from, { lat: destination.value.lat, lng: destination.value.lng })
  } catch {
    error.value = 'Could not find a driving route'
    route.value = null
  } finally {
    loadingRoute.value = false
  }
}

async function reroute() {
  if (!destination.value || !position.value) return
  rerouteBusy = true
  try {
    const r = await fetchRoute(position.value, {
      lat: destination.value.lat,
      lng: destination.value.lng,
    })
    route.value = r
    setRouteLine(r.geometry)
  } catch {
    // keep old route
  } finally {
    window.setTimeout(() => {
      rerouteBusy = false
    }, 4000)
  }
}

function fitRoute(from: LatLng, to: LatLng) {
  if (!map) return
  const bounds = new maplibregl.LngLatBounds()
  bounds.extend([from.lng, from.lat])
  bounds.extend([to.lng, to.lat])
  for (const c of route.value?.geometry ?? []) bounds.extend([c.lng, c.lat])
  map.fitBounds(bounds, { padding: 100, pitch: 0, bearing: 0, duration: 800, maxZoom: 15 })
}

function startNavigation() {
  if (!route.value) return
  if (!position.value) position.value = KYIV
  phase.value = 'navigating'
  follow.value = true
  map?.easeTo({
    center: [position.value.lng, position.value.lat],
    zoom: 16.5,
    pitch: 55,
    bearing: heading.value ?? 0,
    duration: 900,
  })
}

function exitNavigation() {
  phase.value = 'search'
  follow.value = true
  route.value = null
  destination.value = null
  query.value = ''
  results.value = []
  setRouteLine([])
  destMarker?.remove()
  destMarker = null
  map?.easeTo({ pitch: 0, bearing: 0, zoom: 13, duration: 600 })
}

function recenter() {
  follow.value = true
  if (!position.value || !map) return
  const brg = progress.value?.bearing ?? heading.value ?? 0
  map.easeTo({
    center: [position.value.lng, position.value.lat],
    zoom: 16.5,
    pitch: 55,
    bearing: brg,
    duration: 600,
  })
}

function goBack() {
  if (phase.value === 'navigating') {
    exitNavigation()
    return
  }
  if (phase.value === 'preview') {
    exitNavigation()
    return
  }
  router.push('/')
}

onMounted(() => {
  initMap()
  startGps()
})

onUnmounted(() => {
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  if (searchTimer) window.clearTimeout(searchTimer)
  map?.remove()
  map = null
})
</script>

<template>
  <div class="nav-root">
    <div ref="mapEl" class="nav-map" />

    <!-- SEARCH -->
    <div v-if="phase === 'search' || phase === 'preview'" class="nav-top">
      <button class="icon-btn" type="button" aria-label="Back" @click="goBack">
        <ArrowLeft :size="28" />
      </button>
      <div class="search-box">
        <Search :size="22" class="search-icon" />
        <input
          v-model="query"
          class="search-input"
          type="search"
          enterkeyhint="search"
          placeholder="Choose destination"
          autocomplete="off"
          autocapitalize="off"
        />
        <button v-if="query" class="clear-btn" type="button" aria-label="Clear" @click="query = ''; results = []">
          <X :size="20" />
        </button>
      </div>
    </div>

    <div v-if="phase === 'search' && results.length" class="results">
      <button
        v-for="place in results"
        :key="place.id"
        type="button"
        class="result-row"
        @click="selectPlace(place)"
      >
        <Navigation :size="20" class="result-pin" />
        <div class="result-text">
          <div class="result-name">{{ place.name }}</div>
          <div class="result-addr">{{ place.address }}</div>
        </div>
      </button>
    </div>

    <!-- MANEUVER BANNER (Google-style) -->
    <div v-if="phase === 'navigating' && progress" class="maneuver">
      <div class="maneuver-inner">
        <component :is="maneuverIcon" :size="56" class="maneuver-icon" stroke-width="2.4" />
        <div class="maneuver-copy">
          <div class="maneuver-dist">{{ formatDistance(progress.distanceToManeuver) }}</div>
          <div class="maneuver-instr">{{ progress.step.instruction }}</div>
        </div>
      </div>
    </div>

    <p v-if="error" class="toast">{{ error }}</p>
    <p v-if="loadingRoute" class="toast">Getting route…</p>
    <p v-if="phase === 'navigating' && progress?.offRoute" class="toast">Rerouting…</p>

    <!-- PREVIEW GO -->
    <div v-if="phase === 'preview' && route && destination" class="preview-sheet">
      <div class="preview-meta">
        <div class="preview-eta">{{ formatDuration(route.duration) }}</div>
        <div class="preview-sub">
          {{ formatDistance(route.distance) }} · arrive {{ formatEta(route.duration) }}
        </div>
        <div class="preview-dest">{{ destination.name }}</div>
      </div>
      <button class="go-btn" type="button" @click="startNavigation">
        <Navigation :size="26" />
        Start
      </button>
    </div>

    <!-- NAV BOTTOM BAR -->
    <div v-if="phase === 'navigating' && progress" class="nav-sheet">
      <button class="exit-btn" type="button" @click="exitNavigation">Exit</button>
      <div class="nav-stats">
        <div class="stat-main">{{ formatDuration(progress.durationRemaining) }}</div>
        <div class="stat-sub">
          {{ formatDistance(progress.distanceRemaining) }} · {{ formatEta(progress.durationRemaining) }}
        </div>
      </div>
      <button
        class="icon-btn recenter"
        type="button"
        aria-label="Recenter"
        :class="{ dim: follow }"
        @click="recenter"
      >
        <LocateFixed :size="26" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.nav-root {
  --gmaps-blue: #1a73e8;
  --gmaps-green: #0f9d58;
  --sheet: #ffffff;
  --ink: #202124;
  --muted: #5f6368;
  position: relative;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: #e8eaed;
  font-family: "Google Sans", "Product Sans", Roboto, "Segoe UI", sans-serif;
}

.nav-map {
  position: absolute;
  inset: 0;
}

.nav-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 1rem 1rem 0;
  pointer-events: none;
}

.nav-top > * {
  pointer-events: auto;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 3.25rem;
  height: 3.25rem;
  border: none;
  border-radius: 999px;
  background: var(--sheet);
  color: var(--ink);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
  cursor: pointer;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 3.5rem;
  padding: 0 1rem;
  border-radius: 1.75rem;
  background: var(--sheet);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
}

.search-icon {
  color: var(--muted);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 1.15rem;
  color: var(--ink);
}

.search-input::placeholder {
  color: #80868b;
}

.clear-btn {
  border: none;
  background: transparent;
  color: var(--muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0.25rem;
}

.results {
  position: absolute;
  top: 5rem;
  left: 1rem;
  right: 1rem;
  z-index: 5;
  max-height: min(50vh, 22rem);
  overflow: auto;
  border-radius: 1rem;
  background: var(--sheet);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.22);
}

.result-row {
  width: 100%;
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
  padding: 1rem 1.1rem;
  border: none;
  border-bottom: 1px solid #e8eaed;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--ink);
}

.result-row:last-child {
  border-bottom: none;
}

.result-pin {
  color: var(--gmaps-blue);
  margin-top: 0.15rem;
  flex-shrink: 0;
}

.result-name {
  font-size: 1.05rem;
  font-weight: 500;
}

.result-addr {
  margin-top: 0.15rem;
  font-size: 0.9rem;
  color: var(--muted);
}

.maneuver {
  position: absolute;
  top: 1rem;
  left: 1rem;
  right: 1rem;
  z-index: 5;
  pointer-events: none;
}

.maneuver-inner {
  display: flex;
  gap: 1rem;
  align-items: center;
  max-width: 36rem;
  padding: 1rem 1.25rem;
  border-radius: 1rem;
  background: #202124;
  color: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.maneuver-icon {
  flex-shrink: 0;
  color: #fff;
}

.maneuver-dist {
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.maneuver-instr {
  margin-top: 0.2rem;
  font-size: 1.15rem;
  font-weight: 400;
  opacity: 0.95;
  line-height: 1.25;
}

.preview-sheet,
.nav-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem 1.25rem calc(1.1rem + env(safe-area-inset-bottom));
  background: var(--sheet);
  color: var(--ink);
  box-shadow: 0 -2px 16px rgba(0, 0, 0, 0.18);
}

.preview-meta {
  flex: 1;
  min-width: 0;
}

.preview-eta,
.stat-main {
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--gmaps-green);
  line-height: 1.1;
}

.preview-sub,
.stat-sub {
  margin-top: 0.2rem;
  font-size: 1rem;
  color: var(--muted);
}

.preview-dest {
  margin-top: 0.35rem;
  font-size: 1.05rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.go-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: none;
  border-radius: 999px;
  padding: 1rem 1.6rem;
  background: var(--gmaps-blue);
  color: #fff;
  font-size: 1.2rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(26, 115, 232, 0.45);
}

.exit-btn {
  border: none;
  border-radius: 999px;
  padding: 0.85rem 1.35rem;
  background: #f1f3f4;
  color: var(--ink);
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
}

.nav-stats {
  flex: 1;
  text-align: center;
}

.recenter.dim {
  opacity: 0.45;
}

.toast {
  position: absolute;
  left: 50%;
  bottom: 7.5rem;
  z-index: 6;
  transform: translateX(-50%);
  padding: 0.7rem 1rem;
  border-radius: 999px;
  background: rgba(32, 33, 36, 0.92);
  color: #fff;
  font-size: 0.95rem;
  white-space: nowrap;
  max-width: 90vw;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (min-width: 900px) {
  .maneuver-inner {
    max-width: 28rem;
  }

  .preview-sheet,
  .nav-sheet {
    left: 50%;
    right: auto;
    width: min(42rem, calc(100% - 2rem));
    transform: translateX(-50%);
    bottom: 1.25rem;
    border-radius: 1.25rem;
  }

  .toast {
    bottom: 8.5rem;
  }
}
</style>

<style>
.nav-puck {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
}

.nav-puck-arrow {
  width: 0;
  height: 0;
  border-left: 11px solid transparent;
  border-right: 11px solid transparent;
  border-bottom: 26px solid #1a73e8;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
  transform-origin: 50% 70%;
}

.nav-dest {
  width: 22px;
  height: 22px;
  border-radius: 50% 50% 50% 0;
  background: #ea4335;
  transform: rotate(-45deg);
  border: 3px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}

.maplibregl-ctrl-bottom-right {
  bottom: 6.5rem !important;
  right: 0.75rem !important;
}
</style>
