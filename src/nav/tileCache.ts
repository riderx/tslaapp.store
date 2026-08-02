import maplibregl from 'maplibre-gl'
import type { LatLng } from './types'
import { haversine } from './geo'

const CACHE_NAME = 'tslap-nav-tiles-v1'
const PROTOCOL = 'navcache'
const MAX_CACHE_ENTRIES = 800
const PREFETCH_ZOOMS = [12, 13, 14, 15, 16]
const PREFETCH_STEP_M = 350
const PREFETCH_MAX_TILES = 420

let installed = false
let vectorTileTemplate: string | null = null

function toCachedUrl(url: string): string {
  if (url.startsWith(`${PROTOCOL}://`)) return url
  if (url.startsWith('https://')) return `${PROTOCOL}://${url.slice('https://'.length)}`
  if (url.startsWith('http://')) return `${PROTOCOL}://${url.slice('http://'.length)}`
  return url
}

function toHttpsUrl(protocolUrl: string): string {
  if (protocolUrl.startsWith(`${PROTOCOL}://`)) {
    return `https://${protocolUrl.slice(PROTOCOL.length + 3)}`
  }
  return protocolUrl
}

async function openCache(): Promise<Cache> {
  return caches.open(CACHE_NAME)
}

async function pruneCache(cache: Cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_CACHE_ENTRIES) return
  const drop = keys.length - MAX_CACHE_ENTRIES
  for (let i = 0; i < drop; i++) {
    await cache.delete(keys[i])
  }
}

/** Network with cache fallback; stores successful responses. */
export async function cachedFetch(url: string, init?: RequestInit): Promise<Response> {
  const cache = await openCache()
  const req = new Request(url, init)
  try {
    const res = await fetch(req)
    if (res.ok) {
      await cache.put(req, res.clone())
      void pruneCache(cache)
    }
    return res
  } catch (err) {
    const hit = await cache.match(req)
    if (hit) return hit
    throw err
  }
}

export function installNavTileCache() {
  if (installed) return
  installed = true

  maplibregl.addProtocol(PROTOCOL, async (request, abortController) => {
    const httpsUrl = toHttpsUrl(request.url)
    const cache = await openCache()
    const cached = await cache.match(httpsUrl)

    const fetchOnce = async () => {
      const res = await fetch(httpsUrl, {
        signal: abortController?.signal,
        mode: 'cors',
      })
      if (!res.ok) throw new Error(`Tile HTTP ${res.status}`)
      const data = await res.arrayBuffer()
      await cache.put(httpsUrl, new Response(data.slice(0), { status: 200, headers: res.headers }))
      void pruneCache(cache)
      return data
    }

    // Prefer cache on flaky highway links; refresh in background when online.
    if (cached) {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        void fetchOnce().catch(() => {})
      }
      return { data: await cached.arrayBuffer() }
    }

    try {
      return { data: await fetchOnce() }
    } catch (e) {
      const again = await cache.match(httpsUrl)
      if (again) return { data: await again.arrayBuffer() }
      throw e
    }
  })
}

function rewriteUrlDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.includes('tiles.openfreemap.org') || value.startsWith('https://')) {
      // Only rewrite OpenFreeMap / absolute http(s) asset URLs used by the style
      if (
        value.includes('tiles.openfreemap.org') ||
        value.includes('{z}') ||
        value.includes('{fontstack}') ||
        value.endsWith('.json') ||
        value.endsWith('.pbf') ||
        value.endsWith('.png') ||
        value.includes('/sprites/')
      ) {
        return toCachedUrl(value)
      }
    }
    return value
  }
  if (Array.isArray(value)) return value.map(rewriteUrlDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteUrlDeep(v)
    }
    return out
  }
  return value
}

/** Load style JSON, inline TileJSON, route all assets through the cache protocol. */
export async function loadNavStyle(styleUrl: string): Promise<object> {
  const styleRes = await cachedFetch(styleUrl)
  const style = (await styleRes.json()) as any

  if (style.sources) {
    for (const [id, source] of Object.entries(style.sources as Record<string, any>)) {
      if (source?.url && !source.tiles) {
        try {
          const tjRes = await cachedFetch(source.url)
          const tj = await tjRes.json()
          const tiles = Array.isArray(tj.tiles) ? tj.tiles : []
          if (tiles.length) {
            style.sources[id] = {
              ...source,
              ...tj,
              tiles,
              url: undefined,
            }
            if (id === 'openmaptiles' || source.type === 'vector') {
              vectorTileTemplate = String(tiles[0])
            }
          }
        } catch {
          // keep original url; protocol rewrite still helps when fetch works later
        }
      } else if (Array.isArray(source?.tiles) && source.tiles[0]) {
        if (source.type === 'vector') vectorTileTemplate = String(source.tiles[0])
      }
    }
  }

  return rewriteUrlDeep(style) as object
}

function lngLatToTile(lng: number, lat: number, z: number) {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return {
    z,
    x: Math.min(n - 1, Math.max(0, x)),
    y: Math.min(n - 1, Math.max(0, y)),
  }
}

function sampleRoute(geometry: LatLng[], stepM: number): LatLng[] {
  if (geometry.length < 2) return geometry.slice()
  const out: LatLng[] = [geometry[0]]
  let acc = 0
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1]
    const b = geometry[i]
    const seg = haversine(a, b)
    acc += seg
    if (acc >= stepM) {
      out.push(b)
      acc = 0
    }
  }
  const last = geometry[geometry.length - 1]
  const prev = out[out.length - 1]
  if (prev.lat !== last.lat || prev.lng !== last.lng) out.push(last)
  return out
}

function tileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{Y}', String(y))
}

let prefetchGen = 0

/** Warm cache for vector tiles covering the route (best-effort, cancelled by newer calls). */
export async function prefetchRouteTiles(geometry: LatLng[]): Promise<void> {
  if (!geometry.length || typeof navigator !== 'undefined' && !navigator.onLine) return
  const template = vectorTileTemplate
  if (!template) return

  const gen = ++prefetchGen
  const samples = sampleRoute(geometry, PREFETCH_STEP_M)
  const urls = new Set<string>()

  for (const p of samples) {
    for (const z of PREFETCH_ZOOMS) {
      const { x, y } = lngLatToTile(p.lng, p.lat, z)
      // also neighbors so panning/bearing still has tiles
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          urls.add(tileUrl(template, z, x + dx, y + dy))
          if (urls.size >= PREFETCH_MAX_TILES) break
        }
        if (urls.size >= PREFETCH_MAX_TILES) break
      }
      if (urls.size >= PREFETCH_MAX_TILES) break
    }
    if (urls.size >= PREFETCH_MAX_TILES) break
  }

  const list = [...urls]
  const concurrency = 6
  let i = 0

  async function worker() {
    while (i < list.length) {
      if (gen !== prefetchGen) return
      const idx = i++
      const url = list[idx]
      try {
        await cachedFetch(url)
      } catch {
        // ignore individual tile failures
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}
