import type { LatLng, NavStep, RouteResult, TrafficSegment } from './types'
import { fetchGoogleRoutes } from './googleRoute'
import { instructionFor } from './instructions'

const OSRM = 'https://router.project-osrm.org/route/v1/driving'

function toLatLng(coord: [number, number]): LatLng {
  return { lng: coord[0], lat: coord[1] }
}

async function fetchGoogleTrafficRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  const res = await fetch('/api/nav/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return {
    distance: data.distance,
    duration: data.duration,
    durationStatic: data.durationStatic,
    geometry: data.geometry,
    steps: data.steps as NavStep[],
    traffic: data.traffic as TrafficSegment[] | undefined,
    hasTraffic: true,
  }
}

async function fetchOsrmRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  const path = `${from.lng},${from.lat};${to.lng},${to.lat}`
  const url = `${OSRM}/${path}?overview=full&geometries=geojson&steps=true&annotations=false`

  const res = await fetch(url)
  if (!res.ok) throw new Error('Routing failed')
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route found')

  const route = data.routes[0]
  const leg = route.legs[0]
  const geometry = (route.geometry.coordinates as [number, number][]).map(toLatLng)

  const steps: NavStep[] = (leg.steps as any[]).map((step) => {
    const type = step.maneuver?.type ?? 'continue'
    const modifier = step.maneuver?.modifier
    const name = step.name || ''
    const coords = (step.geometry?.coordinates as [number, number][] | undefined)?.map(toLatLng) ?? []
    const [lng, lat] = step.maneuver.location as [number, number]
    return {
      distance: step.distance,
      duration: step.duration,
      name,
      instruction: instructionFor(type, modifier, name),
      type,
      modifier,
      location: { lat, lng },
      geometry: coords,
    }
  })

  return {
    distance: route.distance,
    duration: route.duration,
    geometry,
    steps,
    hasTraffic: false,
  }
}

/** Prefer Google live traffic ETA/colors; fall back to OSRM. */
export async function fetchRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  try {
    return await fetchGoogleRoutes(from, to)
  } catch {
    try {
      return await fetchGoogleTrafficRoute(from, to)
    } catch {
      return await fetchOsrmRoute(from, to)
    }
  }
}
