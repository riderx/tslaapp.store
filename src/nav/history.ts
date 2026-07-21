import type { PlaceResult } from './types'

const KEY = 'tslap-nav-history'
const MAX = 8

export function loadHistory(): PlaceResult[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PlaceResult[]
    return Array.isArray(parsed) ? parsed.filter(isPlace).slice(0, MAX) : []
  } catch {
    return []
  }
}

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

export function saveHistory(places: PlaceResult[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(places.slice(0, MAX)))
  } catch {
    // quota / private mode
  }
}

export function pushHistory(place: PlaceResult): PlaceResult[] {
  const next = [
    place,
    ...loadHistory().filter(
      (p) => !(p.id === place.id || (p.lat === place.lat && p.lng === place.lng)),
    ),
  ].slice(0, MAX)
  saveHistory(next)
  return next
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
