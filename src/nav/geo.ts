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

export function computeProgress(position: LatLng, route: RouteResult, heading?: number): NavProgress {
  const proj = projectOnRoute(position, route.geometry)
  const offRoute = proj.distanceToRoute > 60

  // Cumulative step end distances
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
  // Skip tiny arrive flicker: keep previous until close
  if (stepIndex >= route.steps.length) stepIndex = route.steps.length - 1

  const step = route.steps[stepIndex]
  const distanceToManeuver = Math.max(0, stepEnds[stepIndex] - proj.distanceAlong)
  const distanceRemaining = Math.max(0, route.distance - proj.distanceAlong)
  const ratio = route.distance > 0 ? distanceRemaining / route.distance : 0
  const durationRemaining = route.duration * ratio

  // Look ahead for bearing along route
  const look = route.geometry[Math.min(proj.segmentIndex + 1, route.geometry.length - 1)]
  const routeBearing = bearing(proj.nearest, look)

  return {
    stepIndex,
    step,
    distanceToManeuver,
    distanceRemaining,
    durationRemaining,
    offRoute,
    bearing: heading ?? routeBearing,
  }
}
