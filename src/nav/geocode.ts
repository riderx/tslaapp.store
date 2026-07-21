import type { PlaceResult } from './types'

const PHOTON = 'https://photon.komoot.io/api/'

export async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number },
): Promise<PlaceResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const url = new URL(PHOTON)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '8')
  url.searchParams.set('lang', 'en')
  // Bias Ukraine / Eastern Europe
  url.searchParams.set('bbox', '22.0,44.0,40.5,52.5')
  if (near) {
    url.searchParams.set('lat', String(near.lat))
    url.searchParams.set('lon', String(near.lng))
  }

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error('Place search failed')
  const data = await res.json()

  return (data.features ?? []).map((f: any, i: number) => {
    const p = f.properties ?? {}
    const [lng, lat] = f.geometry.coordinates
    const name = p.name || p.street || p.city || q
    const parts = [p.street, p.housenumber, p.city || p.town || p.village, p.state, p.country]
      .filter(Boolean)
      .join(', ')
    return {
      id: String(p.osm_id ?? i),
      name,
      address: parts || name,
      lat,
      lng,
    } satisfies PlaceResult
  })
}
