export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—'
  if (meters < 1000) {
    const rounded = meters < 100 ? Math.max(10, Math.round(meters / 10) * 10) : Math.round(meters / 50) * 50
    return `${rounded} m`
  }
  const km = meters / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${Math.max(1, mins)} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

export function formatEta(seconds: number): string {
  const arrival = new Date(Date.now() + seconds * 1000)
  return arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
