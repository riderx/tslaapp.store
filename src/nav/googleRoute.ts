import type { LatLng, NavStep, RouteResult, TrafficSegment, TrafficSpeed } from './types'

function parseDurationSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const m = value.match(/^(\d+(?:\.\d+)?)s$/)
    if (m) return Number(m[1])
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function decodePolyline(encoded: string): LatLng[] {
  let index = 0
  const len = encoded.length
  let lat = 0
  let lng = 0
  const path: LatLng[] = []
  while (index < len) {
    let b = 0
    let shift = 0
    let result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    path.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return path
}

function intervalsToTraffic(geometry: LatLng[], intervals: any[]): TrafficSegment[] {
  if (!geometry.length) return []
  if (!intervals?.length) {
    return [{ speed: 'NORMAL', coordinates: geometry.map((p) => [p.lng, p.lat]) }]
  }
  const out: TrafficSegment[] = []
  for (const iv of intervals) {
    const start = Math.max(0, iv.startPolylinePointIndex ?? 0)
    const end = Math.min(geometry.length - 1, iv.endPolylinePointIndex ?? geometry.length - 1)
    if (end <= start) continue
    const speed = (iv.speed === 'SLOW' || iv.speed === 'TRAFFIC_JAM' ? iv.speed : 'NORMAL') as TrafficSpeed
    const slice = geometry.slice(start, end + 1)
    if (slice.length < 2) continue
    out.push({ speed, coordinates: slice.map((p) => [p.lng, p.lat]) })
  }
  return out.length
    ? out
    : [{ speed: 'NORMAL', coordinates: geometry.map((p) => [p.lng, p.lat]) }]
}

function normalizeStep(step: any, fallback: LatLng): NavStep {
  const raw = String(step.navigationInstruction?.maneuver || 'continue')
  const lower = raw.toLowerCase().replace(/_/g, ' ')
  let modifier: string | undefined
  let simpleType = 'turn'
  if (lower.includes('u turn') || lower.includes('uturn')) {
    simpleType = 'turn'
    modifier = 'uturn'
  } else if (lower.includes('roundabout')) simpleType = 'roundabout'
  else if (lower.includes('arrive') || lower.includes('destination')) simpleType = 'arrive'
  else if (lower.includes('depart')) simpleType = 'depart'
  else if (lower.includes('merge')) simpleType = 'merge'
  else if (lower.includes('fork')) simpleType = 'fork'
  else if (lower.includes('ramp')) simpleType = lower.includes('off') ? 'off ramp' : 'on ramp'
  else if (lower.includes('straight')) {
    simpleType = 'continue'
    modifier = 'straight'
  } else if (lower.includes('left')) {
    modifier = lower.includes('sharp') ? 'sharp left' : lower.includes('slight') ? 'slight left' : 'left'
  } else if (lower.includes('right')) {
    modifier = lower.includes('sharp') ? 'sharp right' : lower.includes('slight') ? 'slight right' : 'right'
  }
  const instruction =
    step.navigationInstruction?.instructions ||
    (simpleType === 'arrive' ? 'You have arrived' : 'Continue')
  const coords = step.polyline?.encodedPolyline ? decodePolyline(step.polyline.encodedPolyline) : []
  return {
    distance: step.distanceMeters ?? 0,
    duration: parseDurationSeconds(step.staticDuration),
    name: '',
    instruction,
    type: simpleType,
    modifier,
    location: {
      lat: step.startLocation?.latLng?.latitude ?? coords[0]?.lat ?? fallback.lat,
      lng: step.startLocation?.latLng?.longitude ?? coords[0]?.lng ?? fallback.lng,
    },
    geometry: coords,
  }
}

/** Browser call — uses referrer-restricted Maps key. Requires Routes API enabled. */
export async function fetchGoogleRoutes(from: LatLng, to: LatLng): Promise<RouteResult> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY')

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction,routes.legs.steps.polyline,routes.legs.steps.startLocation',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      extraComputations: ['TRAFFIC_ON_POLYLINE'],
      polylineQuality: 'HIGH_QUALITY',
      languageCode: 'en',
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data?.error?.message || `Routes HTTP ${res.status}`)
  }
  const route = data.routes?.[0]
  if (!route) throw new Error('No route')

  const geometry = decodePolyline(route.polyline?.encodedPolyline || '')
  const steps = (route.legs?.[0]?.steps || []).map((s: any) => normalizeStep(s, from))

  return {
    distance: route.distanceMeters ?? 0,
    duration: parseDurationSeconds(route.duration),
    durationStatic: parseDurationSeconds(route.staticDuration) || undefined,
    geometry,
    steps,
    traffic: intervalsToTraffic(geometry, route.travelAdvisory?.speedReadingIntervals || []),
    hasTraffic: true,
  }
}
