/** Google traffic-aware routing for the nav UI (server-side; no CORS). */

export type SpeedKind = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM'

export type NavRouteResponse = {
  distance: number
  duration: number
  durationStatic?: number
  geometry: { lat: number; lng: number }[]
  steps: {
    distance: number
    duration: number
    name: string
    instruction: string
    type: string
    modifier?: string
    location: { lat: number; lng: number }
    geometry: { lat: number; lng: number }[]
  }[]
  /** Polyline segments colored by live traffic */
  traffic: { speed: SpeedKind; coordinates: [number, number][] }[]
  provider: 'google-routes' | 'google-directions'
}

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

/** Google encoded polyline → lat/lng */
export function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  let index = 0
  const len = encoded.length
  let lat = 0
  let lng = 0
  const path: { lat: number; lng: number }[] = []

  while (index < len) {
    let b: number
    let shift = 0
    let result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    path.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return path
}

function instructionFor(type: string, modifier: string | undefined, name: string): string {
  const mod = modifier || 'straight'
  switch (type) {
    case 'depart':
      return name ? `Head on ${name}` : 'Continue straight'
    case 'arrive':
      return 'You have arrived'
    case 'roundabout':
    case 'rotary':
      return name ? `Enter the roundabout toward ${name}` : 'Enter the roundabout'
    case 'exit roundabout':
    case 'exit rotary':
      return name ? `Exit the roundabout onto ${name}` : 'Exit the roundabout'
    case 'merge':
      return name ? `Merge onto ${name}` : 'Merge'
    case 'onRamp':
    case 'on ramp':
      return name ? `Take the ramp onto ${name}` : 'Take the ramp'
    case 'offRamp':
    case 'off ramp':
      return name ? `Take the exit onto ${name}` : 'Take the exit'
    case 'fork':
      return mod.includes('left')
        ? `Keep left${name ? ` onto ${name}` : ''}`
        : `Keep right${name ? ` onto ${name}` : ''}`
    case 'turn':
    default: {
      const t = type === 'turn' ? 'Turn' : 'Continue'
      if (mod === 'uturn' || mod === 'u-turn') return name ? `Make a U-turn onto ${name}` : 'Make a U-turn'
      if (mod === 'straight') return name ? `Continue onto ${name}` : 'Continue straight'
      if (mod.includes('left')) {
        const sharp = mod.includes('sharp') ? 'sharp ' : mod.includes('slight') ? 'slight ' : ''
        return `${t} ${sharp}left${name ? ` onto ${name}` : ''}`.replace('Continue ', 'Turn ')
      }
      if (mod.includes('right')) {
        const sharp = mod.includes('sharp') ? 'sharp ' : mod.includes('slight') ? 'slight ' : ''
        return `${t} ${sharp}right${name ? ` onto ${name}` : ''}`.replace('Continue ', 'Turn ')
      }
      return name ? `Continue onto ${name}` : 'Continue straight'
    }
  }
}

function intervalsToTraffic(
  geometry: { lat: number; lng: number }[],
  intervals: { startPolylinePointIndex?: number; endPolylinePointIndex?: number; speed?: string }[],
): NavRouteResponse['traffic'] {
  if (!geometry.length) return []
  if (!intervals?.length) {
    return [
      {
        speed: 'NORMAL',
        coordinates: geometry.map((p) => [p.lng, p.lat] as [number, number]),
      },
    ]
  }

  const out: NavRouteResponse['traffic'] = []
  for (const iv of intervals) {
    const start = Math.max(0, iv.startPolylinePointIndex ?? 0)
    const end = Math.min(geometry.length - 1, iv.endPolylinePointIndex ?? geometry.length - 1)
    if (end <= start) continue
    const speed = (iv.speed === 'SLOW' || iv.speed === 'TRAFFIC_JAM' ? iv.speed : 'NORMAL') as SpeedKind
    const slice = geometry.slice(start, end + 1)
    if (slice.length < 2) continue
    out.push({
      speed,
      coordinates: slice.map((p) => [p.lng, p.lat] as [number, number]),
    })
  }
  return out.length
    ? out
    : [
        {
          speed: 'NORMAL',
          coordinates: geometry.map((p) => [p.lng, p.lat] as [number, number]),
        },
      ]
}

async function routesApi(
  key: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<NavRouteResponse> {
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
  const data = await res.json<any>()
  if (!res.ok) {
    throw new Error(data?.error?.message || `Routes API HTTP ${res.status}`)
  }
  const route = data.routes?.[0]
  if (!route) throw new Error('No route')

  const geometry = decodePolyline(route.polyline?.encodedPolyline || '')
  const steps = (route.legs?.[0]?.steps || []).map((step: any) => {
    const type = step.navigationInstruction?.maneuver || 'continue'
    // Google uses TURN_LEFT style — normalize
    const raw = String(type)
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
    const name = step.navigationInstruction?.instructions?.replace(/^.*onto /i, '') || ''
    const instr = step.navigationInstruction?.instructions || instructionFor(simpleType, modifier, name)
    const coords = step.polyline?.encodedPolyline
      ? decodePolyline(step.polyline.encodedPolyline)
      : []
    const lat = step.startLocation?.latLng?.latitude ?? coords[0]?.lat ?? from.lat
    const lng = step.startLocation?.latLng?.longitude ?? coords[0]?.lng ?? from.lng
    return {
      distance: step.distanceMeters ?? 0,
      duration: parseDurationSeconds(step.staticDuration),
      name,
      instruction: instr,
      type: simpleType,
      modifier,
      location: { lat, lng },
      geometry: coords,
    }
  })

  return {
    distance: route.distanceMeters ?? 0,
    duration: parseDurationSeconds(route.duration),
    durationStatic: parseDurationSeconds(route.staticDuration) || undefined,
    geometry,
    steps,
    traffic: intervalsToTraffic(geometry, route.travelAdvisory?.speedReadingIntervals || []),
    provider: 'google-routes',
  }
}

async function directionsApi(
  key: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<NavRouteResponse> {
  const params = new URLSearchParams({
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    mode: 'driving',
    departure_time: 'now',
    alternatives: 'false',
    language: 'en',
    key,
  })
  const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`)
  const data = await res.json<any>()
  if (data.status !== 'OK' || !data.routes?.[0]) {
    throw new Error(data.error_message || data.status || 'Directions failed')
  }
  const route = data.routes[0]
  const leg = route.legs[0]
  const geometry = decodePolyline(route.overview_polyline?.points || '')
  const duration = leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0
  const durationStatic = leg.duration?.value

  const steps = (leg.steps || []).map((step: any) => {
    const type = step.maneuver || 'continue'
    // HTML instructions → plain
    const instruction = String(step.html_instructions || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const coords = step.polyline?.points ? decodePolyline(step.polyline.points) : []
    return {
      distance: step.distance?.value ?? 0,
      duration: step.duration?.value ?? 0,
      name: '',
      instruction: instruction || 'Continue',
      type: String(type).includes('turn') ? 'turn' : type,
      modifier: undefined,
      location: {
        lat: step.start_location?.lat ?? from.lat,
        lng: step.start_location?.lng ?? from.lng,
      },
      geometry: coords,
    }
  })

  // No interval data — whole remaining route one color; UI can still tint by delay ratio
  let speed: SpeedKind = 'NORMAL'
  if (durationStatic && duration > durationStatic * 1.35) speed = 'TRAFFIC_JAM'
  else if (durationStatic && duration > durationStatic * 1.15) speed = 'SLOW'

  return {
    distance: leg.distance?.value ?? 0,
    duration,
    durationStatic,
    geometry,
    steps,
    traffic: [
      {
        speed,
        coordinates: geometry.map((p) => [p.lng, p.lat] as [number, number]),
      },
    ],
    provider: 'google-directions',
  }
}

export async function computeNavRoute(
  key: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<NavRouteResponse> {
  try {
    return await routesApi(key, from, to)
  } catch {
    return await directionsApi(key, from, to)
  }
}
