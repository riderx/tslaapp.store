import type { PlaceResult } from './types'

const KEY = 'tslap-nav-favorites'
const MAX = 20

function isPlace(p: unknown): p is PlaceResult {
  if (!p || typeof p !== 'object') return false
  const o = p as PlaceResult
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.lat === 'number' &&
    typeof o.lng === 'number'
  )
}

export function loadFavorites(): PlaceResult[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PlaceResult[]
    return Array.isArray(parsed) ? parsed.filter(isPlace).slice(0, MAX) : []
  } catch {
    return []
  }
}

function saveFavorites(places: PlaceResult[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(places.slice(0, MAX)))
  } catch {
    // quota / private mode
  }
}

function samePlace(a: PlaceResult, b: PlaceResult) {
  return a.id === b.id || (Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5)
}

export function isFavorite(place: PlaceResult, list = loadFavorites()): boolean {
  return list.some((p) => samePlace(p, place))
}

export function toggleFavorite(place: PlaceResult): PlaceResult[] {
  const cur = loadFavorites()
  const exists = cur.some((p) => samePlace(p, place))
  const next = exists
    ? cur.filter((p) => !samePlace(p, place))
    : [
        {
          id: place.id,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
        },
        ...cur,
      ].slice(0, MAX)
  saveFavorites(next)
  return next
}
