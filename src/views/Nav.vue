<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import maplibregl, { type GeoJSONSource, type Map, type Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Clock,
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
import { clearHistory, loadHistory, pushHistory } from '../nav/history'
import { fetchRoute } from '../nav/osrm'
import { formatDistance, formatDuration, formatEta } from '../nav/format'
import { computeProgress, offsetAlongBearing, projectOnRoute } from '../nav/geo'
import { bboxAround, fetchRadarsInBbox, type RadarPoint, type RadarSection } from '../nav/radars'
import type { LatLng, PlaceResult, RouteResult } from '../nav/types'

const router = useRouter()

type Phase = 'search' | 'preview' | 'navigating'

const KYIV: LatLng = { lat: 50.4501, lng: 30.5234 }
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'
/** Center camera ahead so puck sits lower (Google-style) */
const LOOK_AHEAD_M = 100
const NAV_PITCH = 55
const NAV_ZOOM = 16.8
const CAM_SMOOTH = 0.16

/** Look-ahead shrinks when zoomed out so the puck stays on the road, not floating ahead. */
function lookAheadMeters(zoom: number): number {
  const z0 = 13.4
  const z1 = NAV_ZOOM
  const t = Math.max(0, Math.min(1, (zoom - z0) / (z1 - z0)))
  // ease: keep almost full offset near nav zoom, drop quickly when unpinching out
  return LOOK_AHEAD_M * t * t
}

function pitchForZoom(zoom: number): number {
  if (zoom >= 16) return NAV_PITCH
  if (zoom <= 13.5) return 0
  return NAV_PITCH * ((zoom - 13.5) / (16 - 13.5))
}

const mapEl = ref<HTMLElement | null>(null)
const phase = ref<Phase>('search')
const query = ref('')
const results = ref<PlaceResult[]>([])
const history = ref<PlaceResult[]>(loadHistory())
const searchFocused = ref(false)
const searching = ref(false)
const error = ref('')
const position = ref<LatLng | null>(null)
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
let rerouteTimer: number | null = null
let disposed = false
let rerouteBusy = false
let radarAbort: AbortController | null = null
let radarTimer: number | null = null
let radarsLoaded = false
let lastRouteSplitAt = 0
let lastSplitSeg = -1
let camRaf = 0
let camActive = false
/** Ignore MapLibre rotate/zoom/drag events caused by our own jumpTo/follow */
let ignoreGesturePause = false
let camTarget = {
  lng: KYIV.lng,
  lat: KYIV.lat,
  bearing: 0,
  pitch: 0,
  zoom: 13,
}

function withProgrammaticCamera(fn: () => void) {
  ignoreGesturePause = true
  try {
    fn()
  } finally {
    // Events fire sync + next frame; keep ignore briefly
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ignoreGesturePause = false
      })
    })
  }
}

const showHistory = computed(
  () =>
    phase.value === 'search' &&
    searchFocused.value &&
    query.value.trim().length < 2 &&
    history.value.length > 0,
)
const listRows = computed(() => (showHistory.value ? history.value : results.value))

const progress = computed(() => {
  if (!position.value || !route.value || phase.value !== 'navigating') return null
  return computeProgress(position.value, route.value, heading.value)
})

const maneuverIcon = computed(() => {
  const step = progress.value?.step
  if (!step) return ArrowUp
  const type = step.type
  if (type === 'arrive') return Flag
  const mod = (step.modifier || '').toLowerCase()
  if (mod === 'uturn') return RotateCcw
  if (mod.includes('left')) return mod.includes('slight') ? CornerUpLeft : ArrowLeft
  if (mod.includes('right')) return mod.includes('slight') ? CornerUpRight : ArrowRight
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return RotateCcw
  return ArrowUp
})

function setCamTarget(partial: Partial<typeof camTarget>, start = false) {
  if (disposed || !map) return
  camTarget = { ...camTarget, ...partial }
  if (!camActive || start) startCameraLoop()
}

function startCameraLoop() {
  if (disposed || !map) return
  camActive = true
  if (camRaf) cancelAnimationFrame(camRaf)
  const step = () => {
    if (disposed || !map || !camActive) return
    const c = map.getCenter()
    let bDiff = ((camTarget.bearing - map.getBearing() + 540) % 360) - 180
    const pitchDiff = camTarget.pitch - map.getPitch()
    const zoomDiff = camTarget.zoom - map.getZoom()
    const big =
      Math.abs(camTarget.lng - c.lng) > 0.002 ||
      Math.abs(camTarget.lat - c.lat) > 0.002 ||
      Math.abs(bDiff) > 20 ||
      Math.abs(pitchDiff) > 10 ||
      Math.abs(zoomDiff) > 1
    const a = big ? 0.24 : CAM_SMOOTH
    const lng = c.lng + (camTarget.lng - c.lng) * a
    const lat = c.lat + (camTarget.lat - c.lat) * a
    const bearing = map.getBearing() + bDiff * a
    const pitch = map.getPitch() + pitchDiff * a
    const zoom = map.getZoom() + zoomDiff * a
    // MapLibre bearing = heading-up (travel direction is screen-up)
    ignoreGesturePause = true
    map.jumpTo({ center: [lng, lat], bearing, pitch, zoom })
    ignoreGesturePause = false

    bDiff = ((camTarget.bearing - bearing + 540) % 360) - 180
    const moved =
      Math.abs(camTarget.lng - lng) > 1e-7 ||
      Math.abs(camTarget.lat - lat) > 1e-7 ||
      Math.abs(bDiff) > 0.08 ||
      Math.abs(camTarget.pitch - pitch) > 0.08 ||
      Math.abs(camTarget.zoom - zoom) > 0.015
    if (moved) camRaf = requestAnimationFrame(step)
    else {
      camActive = false
      camRaf = 0
    }
  }
  camRaf = requestAnimationFrame(step)
}

function stopCameraLoop() {
  camActive = false
  if (camRaf) cancelAnimationFrame(camRaf)
  camRaf = 0
}

function emptyLine() {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: [] as [number, number][] },
  }
}

function lineFeature(coords: LatLng[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: coords.map((c) => [c.lng, c.lat] as [number, number]),
    },
  }
}

function onMapLoad() {
  if (disposed || !map) return
  map.addSource('route-traveled', { type: 'geojson', data: emptyLine() })
  map.addSource('route-remaining', { type: 'geojson', data: emptyLine() })
  map.addLayer({
    id: 'route-traveled-casing',
    type: 'line',
    source: 'route-traveled',
    paint: { 'line-color': '#9aa0a6', 'line-width': 12, 'line-opacity': 0.55 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  map.addLayer({
    id: 'route-traveled',
    type: 'line',
    source: 'route-traveled',
    paint: { 'line-color': '#c4c7c5', 'line-width': 7 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  map.addLayer({
    id: 'route-remaining-casing',
    type: 'line',
    source: 'route-remaining',
    paint: { 'line-color': '#185abc', 'line-width': 12, 'line-opacity': 0.35 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  map.addLayer({
    id: 'route-remaining',
    type: 'line',
    source: 'route-remaining',
    paint: { 'line-color': '#1a73e8', 'line-width': 7 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })

  map.addSource('radars', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addSource('radar-sections', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  // Tesla-style average-speed corridor (amber band on the road)
  map.addLayer({
    id: 'radar-sections-casing',
    type: 'line',
    source: 'radar-sections',
    paint: {
      'line-color': '#f9a825',
      'line-width': 14,
      'line-opacity': 0.35,
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  map.addLayer({
    id: 'radar-sections-line',
    type: 'line',
    source: 'radar-sections',
    paint: {
      'line-color': '#f57c00',
      'line-width': 6,
      'line-opacity': 0.9,
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })

  const ensureRadarLayer = () => {
    if (!map || map.getLayer('radars-icon')) return
    map.addLayer({
      id: 'radars-icon',
      type: 'symbol',
      source: 'radars',
      layout: {
        'icon-image': 'radar-icon',
        'icon-size': 0.55,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
    })
  }

  const loadRadarIcon = () => {
    if (!map || map.hasImage('radar-icon')) {
      ensureRadarLayer()
      return
    }
    // Rasterize SVG → canvas so MapLibre (and Tesla browser) can use it
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (disposed || !map || map.hasImage('radar-icon')) return
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, 64, 64)
      const data = ctx.getImageData(0, 0, 64, 64)
      map.addImage('radar-icon', data, { sdf: false })
      ensureRadarLayer()
    }
    img.onerror = () => {
      // Fallback: simple canvas badge if SVG fails
      if (disposed || !map || map.hasImage('radar-icon')) return
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.beginPath()
      ctx.arc(32, 32, 28, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.lineWidth = 5
      ctx.strokeStyle = '#e82127'
      ctx.stroke()
      ctx.fillStyle = '#e82127'
      ctx.font = 'bold 28px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('R', 32, 33)
      map.addImage('radar-icon', ctx.getImageData(0, 0, 64, 64), { sdf: false })
      ensureRadarLayer()
    }
    img.src = '/nav-radar.svg'
  }
  loadRadarIcon()
}


function radarsToGeoJSON(points: RadarPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((r) => ({
      type: 'Feature' as const,
      properties: { id: r.id, maxspeed: r.maxspeed ?? '', kind: r.kind },
      geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
    })),
  }
}

function sectionsToGeoJSON(sections: RadarSection[]) {
  return {
    type: 'FeatureCollection' as const,
    features: sections.map((s) => ({
      type: 'Feature' as const,
      properties: { id: s.id, maxspeed: s.maxspeed ?? '' },
      geometry: {
        type: 'LineString' as const,
        coordinates: s.path.map((c) => [c.lng, c.lat] as [number, number]),
      },
    })),
  }
}

function scheduleRadarRefresh() {
  if (disposed) return
  if (radarTimer != null) window.clearTimeout(radarTimer)
  radarTimer = window.setTimeout(() => {
    radarTimer = null
    void refreshRadars()
  }, 450)
}

async function refreshRadars() {
  if (disposed || !map) return
  const b = map.getBounds()
  const south = b.getSouth()
  const west = b.getWest()
  const north = b.getNorth()
  const east = b.getEast()

  // Prefer view bbox; if very zoomed out, clamp around GPS to avoid huge Overpass queries
  const zoom = map.getZoom()
  let box = { south, west, north, east }
  if (zoom < 11 && position.value) {
    box = bboxAround(position.value, 18)
  }

  radarAbort?.abort()
  radarAbort = new AbortController()
  try {
    const data = await fetchRadarsInBbox(
      box.south,
      box.west,
      box.north,
      box.east,
      radarAbort.signal,
    )
    if (disposed || !map) return
    const src = map.getSource('radars') as GeoJSONSource | undefined
    const sec = map.getSource('radar-sections') as GeoJSONSource | undefined
    src?.setData(radarsToGeoJSON(data.points))
    sec?.setData(sectionsToGeoJSON(data.sections))
    radarsLoaded = true
  } catch (e: any) {
    if (e?.name === 'AbortError') return
    // silent — radars are optional
  }
}

function onMapLoadAndRadars() {
  onMapLoad()
  syncPositionOnMap()
  scheduleRadarRefresh()
}

function pauseFollowFromGesture() {
  if (disposed || ignoreGesturePause) return
  follow.value = false
  stopCameraLoop()
}

function initMap() {
  if (!mapEl.value || disposed) return
  map = new maplibregl.Map({
    container: mapEl.value,
    style: STYLE,
    center: [KYIV.lng, KYIV.lat],
    zoom: 13,
    pitch: 0,
    bearing: 0,
    attributionControl: { compact: true },
    dragRotate: true,
    touchZoomRotate: true,
    touchPitch: true,
    pitchWithRotate: true,
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right')
  // Explicit 2-finger twist to change bearing (heading)
  map.touchZoomRotate.enable()
  map.touchZoomRotate.enableRotation()
  map.dragRotate.enable()
  map.on('load', onMapLoadAndRadars)
  map.on('moveend', scheduleRadarRefresh)
  // Any manual pan/rotate/pitch should unlock from auto follow
  map.on('dragstart', pauseFollowFromGesture)
  map.on('rotatestart', pauseFollowFromGesture)
  map.on('pitchstart', pauseFollowFromGesture)
  map.on('zoomstart', pauseFollowFromGesture)
  map.on('zoom', onZoomAdapt)
}

function onZoomAdapt() {
  if (disposed || !map || !follow.value) return
  if (phase.value !== 'navigating' || !position.value || !route.value) return
  const p = computeProgress(position.value, route.value, heading.value)
  const onRoad = p.offRoute
    ? position.value
    : projectOnRoute(position.value, route.value.geometry).nearest
  followCamera(onRoad, p.bearing, true, map.getZoom())
}

function destroyMap() {
  stopCameraLoop()
  locMarker?.remove()
  locMarker = null
  destMarker?.remove()
  destMarker = null
  if (map) {
    map.off('load', onMapLoadAndRadars)
    map.off('dragstart', pauseFollowFromGesture)
    map.off('rotatestart', pauseFollowFromGesture)
    map.off('pitchstart', pauseFollowFromGesture)
    map.off('zoomstart', pauseFollowFromGesture)
    map.off('zoom', onZoomAdapt)
    map.off('moveend', scheduleRadarRefresh)
    map.remove()
    map = null
  }
}

function setRouteLine(coords: LatLng[], splitAt?: LatLng) {
  const traveledSrc = map?.getSource('route-traveled') as GeoJSONSource | undefined
  const remainingSrc = map?.getSource('route-remaining') as GeoJSONSource | undefined
  if (!traveledSrc || !remainingSrc) return
  if (!coords.length) {
    traveledSrc.setData(emptyLine())
    remainingSrc.setData(emptyLine())
    return
  }
  if (!splitAt) {
    traveledSrc.setData(emptyLine())
    remainingSrc.setData(lineFeature(coords))
    return
  }
  const proj = projectOnRoute(splitAt, coords)
  const traveled = [...coords.slice(0, proj.segmentIndex + 1), proj.nearest]
  const remaining = [proj.nearest, ...coords.slice(proj.segmentIndex + 1)]
  traveledSrc.setData(lineFeature(traveled))
  remainingSrc.setData(lineFeature(remaining))
}

function puckHtml() {
  // Top-down Tesla Model 3 (rendered from freecreat GLB); map bearing = nose screen-up
  return `<div class="nav-puck-rot">
    <img class="nav-puck-car" src="/nav-car.png" width="48" height="96" alt="" draggable="false" />
  </div>`
}

function upsertLocMarker(pos: LatLng) {
  if (disposed || !map) return
  if (!locMarker) {
    const el = document.createElement('div')
    el.className = 'nav-puck'
    el.innerHTML = puckHtml()
    locMarker = new maplibregl.Marker({
      element: el,
      anchor: 'center',
      // Stick to the map plane so pitch/zoom don't slide the arrow off the road
      pitchAlignment: 'map',
      rotationAlignment: 'viewport',
    })
      .setLngLat([pos.lng, pos.lat])
      .addTo(map)
  } else {
    locMarker.setLngLat([pos.lng, pos.lat])
  }
}

function upsertDestMarker(pos: LatLng) {
  if (disposed || !map) return
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

function applyGpsFix(pos: GeolocationPosition) {
  if (disposed) return
  position.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
  if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading) && pos.coords.heading >= 0) {
    heading.value = pos.coords.heading
  }
}

function syncPositionOnMap() {
  if (disposed || !map || !position.value) return
  upsertLocMarker(position.value)
  if (phase.value === "search" && !destination.value && follow.value) {
    followCamera(position.value, 0, false)
  }
}

function startGps() {
  if (!navigator.geolocation) {
    error.value = "Geolocation not available in this browser"
    position.value = KYIV
    syncPositionOnMap()
    return
  }

  const opts: PositionOptions = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }

  // Fast first fix so the puck appears as soon as the map is ready
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      applyGpsFix(pos)
      syncPositionOnMap()
    },
    () => {
      // Keep waiting on watchPosition; only fall back if we still have nothing
    },
    opts,
  )

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      applyGpsFix(pos)
      // Map may have loaded after the first fix — always try to paint
      if (map && !locMarker) syncPositionOnMap()
    },
    () => {
      if (disposed) return
      if (!position.value) {
        error.value = "Location denied — using Kyiv. Enable GPS for turn-by-turn."
        position.value = KYIV
        syncPositionOnMap()
      }
    },
    opts,
  )
}

/** Heading-up camera: map bearing = course, center look-ahead */
function followCamera(pos: LatLng, courseDeg: number, navigating: boolean, zoomLock?: number) {
  if (navigating) {
    const zoom = zoomLock ?? map?.getZoom() ?? NAV_ZOOM
    const aheadM = lookAheadMeters(zoom)
    const focus = aheadM > 2 ? offsetAlongBearing(pos, courseDeg, aheadM) : pos
    setCamTarget(
      {
        lng: focus.lng,
        lat: focus.lat,
        bearing: courseDeg,
        pitch: pitchForZoom(zoom),
        zoom,
      },
      true,
    )
  } else {
    setCamTarget({
      lng: pos.lng,
      lat: pos.lat,
      bearing: 0,
      pitch: 0,
      zoom: Math.max(map?.getZoom() ?? 13, 13),
    })
  }
}

watch(position, (pos) => {
  if (disposed || !pos || !map) return
  const now = performance.now()

  if (phase.value === 'search' && !destination.value) {
    upsertLocMarker(pos)
    followCamera(pos, 0, false)
    return
  }

  if (phase.value === 'navigating' && route.value) {
    const p = computeProgress(pos, route.value, heading.value)
    // Keep arrow on the road centerline (GPS alone drifts visually when zoom changes)
    const onRoad = p.offRoute
      ? pos
      : projectOnRoute(pos, route.value.geometry).nearest
    upsertLocMarker(onRoad)

    if (p.segmentIndex !== lastSplitSeg || now - lastRouteSplitAt > 500) {
      lastSplitSeg = p.segmentIndex
      lastRouteSplitAt = now
      setRouteLine(route.value.geometry, pos)
    }

    if (follow.value) followCamera(onRoad, p.bearing, true)

    if (p.offRoute && !rerouteBusy && destination.value) void reroute()
    return
  }

  upsertLocMarker(pos)
})

watch(query, (q) => {
  if (searchTimer != null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  if (q.trim().length < 2) {
    results.value = []
    return
  }
  searchTimer = window.setTimeout(async () => {
    searchTimer = null
    if (disposed) return
    searching.value = true
    error.value = ''
    try {
      const found = await searchPlaces(q, position.value ?? KYIV)
      if (disposed) return
      results.value = found
    } catch {
      if (!disposed) error.value = 'Search failed — check network'
    } finally {
      if (!disposed) searching.value = false
    }
  }, 280)
})

async function selectPlace(place: PlaceResult) {
  destination.value = place
  results.value = []
  searchFocused.value = false
  query.value = place.name
  history.value = pushHistory({
    id: place.id,
    name: place.name,
    address: place.address || place.name,
    lat: place.lat,
    lng: place.lng,
  })
  upsertDestMarker({ lat: place.lat, lng: place.lng })
  await buildRoute()
}

function clearSearchHistory() {
  clearHistory()
  history.value = []
}

function onSearchBlur() {
  window.setTimeout(() => {
    if (!disposed) searchFocused.value = false
  }, 180)
}

async function buildRoute() {
  if (!destination.value || disposed) return
  const from = position.value ?? KYIV
  const dest = destination.value
  loadingRoute.value = true
  error.value = ''
  try {
    const r = await fetchRoute(from, { lat: dest.lat, lng: dest.lng })
    if (disposed) return
    route.value = r
    setRouteLine(r.geometry)
    phase.value = 'preview'
    fitRoute(from, { lat: dest.lat, lng: dest.lng })
  } catch {
    if (!disposed) {
      error.value = 'Could not find a driving route'
      route.value = null
    }
  } finally {
    if (!disposed) loadingRoute.value = false
  }
}

async function reroute() {
  if (!destination.value || !position.value || disposed) return
  rerouteBusy = true
  try {
    const r = await fetchRoute(position.value, {
      lat: destination.value.lat,
      lng: destination.value.lng,
    })
    if (disposed) return
    route.value = r
    setRouteLine(r.geometry, position.value)
  } catch {
    // keep old route
  } finally {
    if (rerouteTimer != null) window.clearTimeout(rerouteTimer)
    rerouteTimer = window.setTimeout(() => {
      rerouteTimer = null
      if (!disposed) rerouteBusy = false
    }, 4000)
  }
}

function fitRoute(from: LatLng, to: LatLng) {
  if (disposed || !map) return
  stopCameraLoop()
  const bounds = new maplibregl.LngLatBounds()
  bounds.extend([from.lng, from.lat])
  bounds.extend([to.lng, to.lat])
  for (const c of route.value?.geometry ?? []) bounds.extend([c.lng, c.lat])
  withProgrammaticCamera(() => {
    map.fitBounds(bounds, { padding: 100, pitch: 0, bearing: 0, duration: 450, maxZoom: 15 })
  })
}

function startNavigation() {
  if (!route.value) return
  if (!position.value) position.value = KYIV
  phase.value = 'navigating'
  follow.value = true
  lastRouteSplitAt = 0
  lastSplitSeg = -1
  setRouteLine(route.value.geometry, position.value)
  const p = computeProgress(position.value, route.value, heading.value)
  upsertLocMarker(position.value)
  const aheadM = lookAheadMeters(NAV_ZOOM)
  const ahead = offsetAlongBearing(position.value, p.bearing, aheadM)
  const onRoad = projectOnRoute(position.value, route.value.geometry).nearest
  upsertLocMarker(onRoad)
  // Snap heading-up immediately — map bearing = course (screen-up = drive direction)
  withProgrammaticCamera(() => {
    map?.jumpTo({
      center: [ahead.lng, ahead.lat],
      bearing: p.bearing,
      pitch: NAV_PITCH,
      zoom: NAV_ZOOM,
    })
  })
  follow.value = true
  followCamera(onRoad, p.bearing, true, NAV_ZOOM)
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
  stopCameraLoop()
  withProgrammaticCamera(() => {
    if (position.value) {
      map?.jumpTo({
        center: [position.value.lng, position.value.lat],
        pitch: 0,
        bearing: 0,
        zoom: 13,
      })
    } else {
      map?.jumpTo({ pitch: 0, bearing: 0, zoom: 13 })
    }
  })
}

function recenter() {
  if (!position.value || !map) return
  follow.value = true
  if (phase.value === 'navigating' && route.value) {
    const p = computeProgress(position.value, route.value, heading.value)
    const onRoad = p.offRoute
      ? position.value
      : projectOnRoute(position.value, route.value.geometry).nearest
    upsertLocMarker(onRoad)
    const ahead = offsetAlongBearing(onRoad, p.bearing, lookAheadMeters(NAV_ZOOM))
    stopCameraLoop()
    withProgrammaticCamera(() => {
      map.jumpTo({
        center: [ahead.lng, ahead.lat],
        bearing: p.bearing,
        pitch: NAV_PITCH,
        zoom: NAV_ZOOM,
      })
    })
    follow.value = true
    followCamera(onRoad, p.bearing, true, NAV_ZOOM)
    return
  }
  stopCameraLoop()
  withProgrammaticCamera(() => {
    map.jumpTo({
      center: [position.value.lng, position.value.lat],
      bearing: 0,
      pitch: 0,
      zoom: Math.max(map.getZoom(), 13),
    })
  })
  followCamera(position.value, 0, false)
}

function goBack() {
  if (phase.value === 'navigating' || phase.value === 'preview') {
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
  disposed = true
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
  if (searchTimer != null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  if (rerouteTimer != null) {
    window.clearTimeout(rerouteTimer)
    rerouteTimer = null
  }
  destroyMap()
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
          @focus="searchFocused = true"
          @blur="onSearchBlur"
        />
        <button
          v-if="query"
          class="clear-btn"
          type="button"
          aria-label="Clear"
          @click="query = ''; results = []"
        >
          <X :size="20" />
        </button>
      </div>
    </div>

    <div v-if="phase === 'search' && listRows.length" class="results">
      <div v-if="showHistory" class="results-head">
        <span>Recent</span>
        <button type="button" class="clear-history" @click="clearSearchHistory">Clear</button>
      </div>
      <button
        v-for="place in listRows"
        :key="place.id"
        type="button"
        class="result-row"
        @click="selectPlace(place)"
      >
        <component :is="showHistory ? Clock : Navigation" :size="20" class="result-pin" />
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

    <!-- Google-style recenter: only when user moved the map -->
    <button
      v-if="phase === 'navigating' && !follow"
      class="recenter-chip"
      type="button"
      @click.stop="recenter"
    >
      <LocateFixed :size="22" />
      Recenter
    </button>

    <!-- NAV BOTTOM BAR -->
    <div v-if="phase === 'navigating' && progress" class="nav-sheet">
      <button class="exit-btn" type="button" @click="exitNavigation">Exit</button>
      <div class="nav-stats">
        <div class="stat-main">{{ formatDuration(progress.durationRemaining) }}</div>
        <div class="stat-sub">
          {{ formatDistance(progress.distanceRemaining) }} · {{ formatEta(progress.durationRemaining) }}
        </div>
      </div>
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
  touch-action: none; /* let MapLibre handle pinch / 2-finger rotate */
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

.results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.1rem 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.clear-history {
  border: none;
  background: transparent;
  color: var(--gmaps-blue);
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
  padding: 0.25rem;
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

.recenter-chip {
  position: absolute;
  left: 50%;
  bottom: calc(5.75rem + env(safe-area-inset-bottom));
  z-index: 6;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: none;
  border-radius: 999px;
  padding: 0.75rem 1.25rem;
  background: var(--sheet);
  color: var(--gmaps-blue);
  font-size: 1.05rem;
  font-weight: 600;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
  cursor: pointer;
}

@media (min-width: 900px) {
  .recenter-chip {
    bottom: calc(7.25rem + env(safe-area-inset-bottom));
  }
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
.maplibregl-ctrl-bottom-right {
  bottom: 6.5rem !important;
  right: 0.75rem !important;
}
</style>


<style>
.nav-puck {
  width: 48px;
  height: 96px;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.nav-puck-rot {
  width: 48px;
  height: 96px;
  display: grid;
  place-items: center;
  transform-origin: 50% 50%;
}

.nav-puck-car {
  display: block;
  width: 48px;
  height: 96px;
  object-fit: contain;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45));
  pointer-events: none;
  user-select: none;
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

