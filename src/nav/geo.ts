import type { LatLng, NavStep, RouteResult } from './types'

const EARTH = 6371000

export function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH * Math.asin(Math.sqrt(h))
}

/** Move `distMeters` along compass bearing from a point (for camera look-ahead). */
export function offsetAlongBearing(origin: LatLng, bearingDeg: number, distMeters: number): LatLng {
  const R = 6371000
  const br = (bearingDeg * Math.PI) / 180
  const lat1 = (origin.lat * Math.PI) / 180
  const lng1 = (origin.lng * Math.PI) / 180
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distMeters / R) +
      Math.cos(lat1) * Math.sin(distMeters / R) * Math.cos(br),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(distMeters / R) * Math.cos(lat1),
      Math.cos(distMeters / R) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI }
}

export function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Nearest point on polyline + distance along route + remaining distance */
export function projectOnRoute(
  point: LatLng,
  route: LatLng[],
): { nearest: LatLng; distanceAlong: number; distanceToRoute: number; segmentIndex: number } {
  let bestDist = Infinity
  let bestPoint = route[0]
  let bestAlong = 0
  let bestSeg = 0
  let along = 0

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]
    const b = route[i + 1]
    const segLen = haversine(a, b)
    const projected = projectOnSegment(point, a, b)
    const d = haversine(point, projected)
    if (d < bestDist) {
      bestDist = d
      bestPoint = projected
      bestAlong = along + haversine(a, projected)
      bestSeg = i
    }
    along += segLen
  }

  return {
    nearest: bestPoint,
    distanceAlong: bestAlong,
    distanceToRoute: bestDist,
    segmentIndex: bestSeg,
  }
}

function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  // Local equirectangular projection for short segments
  const x = p.lng
  const y = p.lat
  const x1 = a.lng
  const y1 = a.lat
  const x2 = b.lng
  const y2 = b.lat
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return a
  let t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
  t = Math.max(0, Math.min(1, t))
  return { lng: x1 + t * dx, lat: y1 + t * dy }
}

export type NavProgress = {
  stepIndex: number
  step: NavStep
  distanceToManeuver: number
  distanceRemaining: number
  durationRemaining: number
  offRoute: boolean
  bearing: number
}

function isPassiveStep(step: NavStep): boolean {
  // Skip "just keep going" steps — banner should show the next real turn (Google-style).
  const t = step.type
  if (t === 'depart' || t === 'notification') return true
  if (t === 'arrive') return false
  const mod = (step.modifier || 'straight').toLowerCase()
  if (t === 'continue' || t === 'new name') {
    return mod === 'straight' || mod === ''
  }
  return false
}

export function computeProgress(position: LatLng, route: RouteResult, heading?: number): NavProgress {
  const proj = projectOnRoute(position, route.geometry)
  const offRoute = proj.distanceToRoute > 60

  let acc = 0
  const stepEnds: number[] = []
  for (const step of route.steps) {
    acc += step.distance
    stepEnds.push(acc)
  }

  let stepIndex = 0
  for (let i = 0; i < stepEnds.length; i++) {
    if (proj.distanceAlong <= stepEnds[i] + 5) {
      stepIndex = i
      break
    }
    stepIndex = i
  }
  if (stepIndex >= route.steps.length) stepIndex = route.steps.length - 1

  // While on depart, preview the next turn (icon + text) with distance until that turn
  let displayIndex = stepIndex
  if (isPassiveStep(route.steps[stepIndex])) {
    for (let i = stepIndex + 1; i < route.steps.length; i++) {
      if (!isPassiveStep(route.steps[i]) && route.steps[i].type !== 'notification') {
        displayIndex = i
        break
      }
    }
  }

  const step = route.steps[displayIndex]
  const distanceToManeuver = Math.max(0, stepEnds[stepIndex] - proj.distanceAlong)
  const distanceRemaining = Math.max(0, route.distance - proj.distanceAlong)
  const ratio = route.distance > 0 ? distanceRemaining / route.distance : 0
  const durationRemaining = route.duration * ratio

  // Look further ahead along the route so course stays stable
  const lookIdx = Math.min(proj.segmentIndex + 3, route.geometry.length - 1)
  const look = route.geometry[lookIdx]
  const routeBearing = bearing(proj.nearest, look)
  // GPS heading is unreliable (often 0). Nav map uses route course so "up" = travel direction.
  const gpsOk =
    heading != null &&
    !Number.isNaN(heading) &&
    heading >= 0 &&
    // ignore exact 0 unless route also says ~north (phones often report 0 when unknown)
    !(heading === 0 && Math.abs(((routeBearing + 180) % 360) - 180) > 25)

  return {
    stepIndex,
    step,
    distanceToManeuver,
    distanceRemaining,
    durationRemaining,
    offRoute,
    bearing: gpsOk ? heading! : routeBearing,
    segmentIndex: proj.segmentIndex,
  }
}
