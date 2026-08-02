import type { PlaceResult } from './types'
import { haversine } from './geo'

const PHOTON = 'https://photon.komoot.io/api/'

/** ~80km box around a point for nearby search (lonMin,latMin,lonMax,latMax). */
function bboxNear(lat: number, lng: number, radiusKm = 80): string {
  const dLat = radiusKm / 111
  const dLng = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  const latMin = lat - dLat
  const latMax = lat + dLat
  const lonMin = lng - dLng
  const lonMax = lng + dLng
  return `${lonMin},${latMin},${lonMax},${latMax}`
}

export async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number },
): Promise<PlaceResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const url = new URL(PHOTON)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '12')
  url.searchParams.set('lang', 'en')

  if (near) {
    url.searchParams.set('lat', String(near.lat))
    url.searchParams.set('lon', String(near.lng))
    // Stronger bias toward the current position
    url.searchParams.set('location_bias_scale', '0.6')
    url.searchParams.set('bbox', bboxNear(near.lat, near.lng, 90))
  } else {
    // Ukraine / Eastern Europe fallback when GPS unknown
    url.searchParams.set('bbox', '22.0,44.0,40.5,52.5')
  }

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error('Place search failed')
  const data = await res.json()

  const places: PlaceResult[] = (data.features ?? []).map((f: any, i: number) => {
    const p = f.properties ?? {}
    const [lng, lat] = f.geometry.coordinates as [number, number]
    const name = p.name || p.street || p.city || q
    const parts = [p.street, p.housenumber, p.city || p.town || p.village, p.state, p.country]
      .filter(Boolean)
      .join(', ')
    const distanceM = near ? haversine(near, { lat, lng }) : undefined
    return {
      id: String(p.osm_id ?? `${lat},${lng},${i}`),
      name,
      address: parts || name,
      lat,
      lng,
      distanceM,
    } satisfies PlaceResult
  })

  if (near) {
    places.sort((a, b) => (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12))
  }
  return places.slice(0, 8)
}
