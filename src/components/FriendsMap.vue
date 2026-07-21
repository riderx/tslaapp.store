<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import maplibregl, { type Map, type Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { storeToRefs } from 'pinia'
import { useFriendsStore } from '@/stores/friendsStore'

const friends = useFriendsStore()
const { locations } = storeToRefs(friends)

const STYLE = 'https://tiles.openfreemap.org/styles/dark'
let map: Map | null = null
const markers = new Map<string, Marker>()
let selfMarker: Marker | null = null

onMounted(() => {
  map = new maplibregl.Map({
    container: 'friends-map',
    style: STYLE,
    center: [-122.0839, 37.3861],
    zoom: 11,
    attributionControl: { compact: true },
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  map.on('load', syncMarkers)
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords
      map?.setCenter([longitude, latitude])
      map?.setZoom(12)
      selfMarker = markerEl('You', true)
      selfMarker.setLngLat([longitude, latitude]).addTo(map!)
    })
  }
})

onUnmounted(() => {
  markers.forEach((m) => m.remove())
  markers.clear()
  selfMarker?.remove()
  map?.remove()
  map = null
})

watch(locations, syncMarkers, { deep: true })

function markerEl(label: string, self = false) {
  const el = document.createElement('div')
  el.className = `friend-pin${self ? ' self' : ''}`
  el.textContent = label
  return new maplibregl.Marker({ element: el, anchor: 'bottom' })
}

function syncMarkers() {
  if (!map) return
  const seen = new Set<string>()
  for (const loc of Object.values(locations.value)) {
    if (!loc.location) continue
    seen.add(loc.userId)
    const lngLat: [number, number] = [loc.location.lng, loc.location.lat]
    const existing = markers.get(loc.userId)
    if (existing) existing.setLngLat(lngLat)
    else markers.set(loc.userId, markerEl(loc.name).setLngLat(lngLat).addTo(map))
  }
  for (const [id, marker] of markers) {
    if (!seen.has(id)) {
      marker.remove()
      markers.delete(id)
    }
  }
}
</script>

<template>
  <div id="friends-map" class="map"></div>
</template>

<style scoped>
.map {
  width: 100%;
  height: 100%;
  min-height: 280px;
  border-radius: 0.75rem;
  overflow: hidden;
  background: #0d0d0d;
}
</style>

<style>
.friend-pin {
  transform: translateY(-4px);
  background: #e82127;
  color: #fff;
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}
.friend-pin.self {
  background: #3b82f6;
}
</style>
