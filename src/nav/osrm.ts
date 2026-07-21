import type { LatLng, NavStep, RouteResult } from './types'

const OSRM = 'https://router.project-osrm.org/route/v1/driving'

function toLatLng(coord: [number, number]): LatLng {
  return { lng: coord[0], lat: coord[1] }
}

function instructionFor(type: string, modifier: string | undefined, name: string): string {
  const road = name || 'the road'
  const mod = modifier || 'straight'

  switch (type) {
    case 'depart':
      return name ? `Head toward ${name}` : 'Depart'
    case 'arrive':
      return 'You have arrived'
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return name ? `Enter the roundabout toward ${name}` : 'Enter the roundabout'
    case 'exit roundabout':
    case 'exit rotary':
      return name ? `Exit the roundabout onto ${name}` : 'Exit the roundabout'
    case 'merge':
      return name ? `Merge onto ${name}` : 'Merge'
    case 'on ramp':
      return name ? `Take the ramp onto ${name}` : 'Take the ramp'
    case 'off ramp':
      return name ? `Take the exit onto ${name}` : 'Take the exit'
    case 'fork':
      return mod.includes('left')
        ? `Keep left${name ? ` onto ${name}` : ''}`
        : `Keep right${name ? ` onto ${name}` : ''}`
    case 'end of road':
      return mod.includes('left')
        ? `Turn left${name ? ` onto ${name}` : ''}`
        : `Turn right${name ? ` onto ${name}` : ''}`
    case 'continue':
    case 'new name':
      return name ? `Continue onto ${name}` : 'Continue straight'
    case 'turn':
    default:
      if (mod === 'uturn') return name ? `Make a U-turn onto ${name}` : 'Make a U-turn'
      if (mod === 'straight') return name ? `Continue onto ${name}` : 'Continue straight'
      if (mod.includes('left')) {
        const sharp = mod.includes('sharp') ? 'sharp ' : mod.includes('slight') ? 'slight ' : ''
        return `Turn ${sharp}left${name ? ` onto ${name}` : ''}`
      }
      if (mod.includes('right')) {
        const sharp = mod.includes('sharp') ? 'sharp ' : mod.includes('slight') ? 'slight ' : ''
        return `Turn ${sharp}right${name ? ` onto ${name}` : ''}`
      }
      return name ? `Continue onto ${name}` : `Continue on ${road}`
  }
}

export async function fetchRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  const path = `${from.lng},${from.lat};${to.lng},${to.lat}`
  const url =
    `${OSRM}/${path}?overview=full&geometries=geojson&steps=true&annotations=false`

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
  }
}
