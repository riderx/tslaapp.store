import type { LatLng } from "./types"

export type RadarPoint = {
  id: string
  lat: number
  lng: number
  maxspeed?: string
  /** fixed camera vs section-control endpoint */
  kind: "fixed" | "section"
}

export type RadarSection = {
  id: string
  maxspeed?: string
  /** road centerline of the controlled stretch */
  path: LatLng[]
  /** exact camera / gate positions along the section */
  devices: RadarPoint[]
}

export type RadarData = {
  points: RadarPoint[]
  sections: RadarSection[]
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
]

const cache = new Map<string, RadarData>()

function cacheKey(south: number, west: number, north: number, east: number): string {
  const q = (n: number) => (Math.round(n * 50) / 50).toFixed(2)
  return `${q(south)}|${q(west)}|${q(north)}|${q(east)}`
}

function wayToPath(way: any): LatLng[] {
  if (Array.isArray(way.geometry)) {
    return way.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon }))
  }
  return []
}

export async function fetchRadarsInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  signal?: AbortSignal,
): Promise<RadarData> {
  const pad = 0.015
  south -= pad
  west -= pad
  north += pad
  east += pad

  const key = cacheKey(south, west, north, east)
  const hit = cache.get(key)
  if (hit) return hit

  // Fixed cameras + Ukraine/common OSM variants + section-control relations
  const query = `
[out:json][timeout:25];
(
  node["highway"="speed_camera"](${south},${west},${north},${east});
  node["device"="speed_camera"](${south},${west},${north},${east});
  node["enforcement"="maxspeed"](${south},${west},${north},${east});
  node["camera:type"="speed"](${south},${west},${north},${east});
  way["highway"="speed_camera"](${south},${west},${north},${east});
  relation["type"="enforcement"]["enforcement"="average_speed"](${south},${west},${north},${east});
  relation["type"="enforcement"]["enforcement"="maxspeed"](${south},${west},${north},${east});
);
out body;
>;
out geom;
`.trim()

  let data: any = null
  let lastErr: unknown
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json",
        },
        signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      data = await res.json()
      break
    } catch (e) {
      lastErr = e
      if ((e as any)?.name === "AbortError") throw e
    }
  }
  if (!data) throw lastErr ?? new Error("Radar fetch failed")

  const elements: any[] = data.elements ?? []
  const nodes = new Map<number, any>()
  const ways = new Map<number, any>()
  const relations: any[] = []

  for (const el of elements) {
    if (el.type === "node") nodes.set(el.id, el)
    else if (el.type === "way") ways.set(el.id, el)
    else if (el.type === "relation") relations.push(el)
  }

  const sectionDeviceIds = new Set<string>()
  const sections: RadarSection[] = []

  for (const rel of relations) {
    const enforcement = rel.tags?.enforcement
    const maxspeed = rel.tags?.maxspeed ? String(rel.tags.maxspeed) : undefined
    const members: any[] = rel.members ?? []

    const devices: RadarPoint[] = []
    const path: LatLng[] = []

    for (const m of members) {
      if (m.type === "node" && (m.role === "device" || m.role === "from" || m.role === "to")) {
        const n = nodes.get(m.ref)
        if (!n || n.lat == null) continue
        const pt: RadarPoint = {
          id: `sec-${rel.id}-${m.role}-${m.ref}`,
          lat: n.lat,
          lng: n.lon,
          maxspeed,
          kind: "section",
        }
        devices.push(pt)
        sectionDeviceIds.add(String(n.id))
      }
      if (m.type === "way" && (m.role === "" || m.role === "way" || m.role === "enforcement")) {
        const w = ways.get(m.ref)
        if (!w) continue
        const seg = wayToPath(w)
        if (!seg.length) continue
        // stitch segments
        if (
          path.length &&
          seg.length &&
          Math.hypot(path[path.length - 1].lat - seg[0].lat, path[path.length - 1].lng - seg[0].lng) >
            Math.hypot(path[path.length - 1].lat - seg[seg.length - 1].lat, path[path.length - 1].lng - seg[seg.length - 1].lng)
        ) {
          path.push(...[...seg].reverse())
        } else {
          path.push(...seg)
        }
      }
    }

    // If no ways but from/to exist, draw a straight corridor between them
    if (path.length < 2) {
      const from = members.find((m) => m.role === "from" && m.type === "node")
      const to = members.find((m) => m.role === "to" && m.type === "node")
      const a = from && nodes.get(from.ref)
      const b = to && nodes.get(to.ref)
      if (a && b) {
        path.push({ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon })
      }
    }

    if (enforcement === "average_speed" && path.length >= 2) {
      sections.push({
        id: String(rel.id),
        maxspeed,
        path,
        devices,
      })
    } else {
      // plain maxspeed enforcement → exact device points only
      for (const d of devices) {
        d.kind = "fixed"
      }
    }
  }

  const points: RadarPoint[] = []

  // Ways tagged as cameras → use first geometry node / center
  for (const w of ways.values()) {
    const tags = w.tags ?? {}
    const isCam =
      tags.highway === "speed_camera" ||
      tags.device === "speed_camera" ||
      tags.enforcement === "maxspeed"
    if (!isCam) continue
    let lat: number | undefined
    let lng: number | undefined
    if (Array.isArray(w.geometry) && w.geometry.length) {
      const mid = w.geometry[Math.floor(w.geometry.length / 2)]
      lat = mid.lat
      lng = mid.lon
    } else if (Array.isArray(w.nodes) && w.nodes.length) {
      const n = nodes.get(w.nodes[Math.floor(w.nodes.length / 2)])
      if (n) { lat = n.lat; lng = n.lon }
    }
    if (lat == null || lng == null) continue
    points.push({
      id: `way-${w.id}`,
      lat,
      lng,
      maxspeed: tags.maxspeed ? String(tags.maxspeed) : undefined,
      kind: "fixed",
    })
  }

  // Standalone fixed cameras (not already part of a section device list)
  for (const n of nodes.values()) {
    const tags = n.tags ?? {}
    const isCam =
      tags.highway === "speed_camera" ||
      tags.device === "speed_camera" ||
      tags["speed_camera"] === "yes" ||
      tags.enforcement === "maxspeed" ||
      tags["camera:type"] === "speed"
    if (!isCam) continue
    if (sectionDeviceIds.has(String(n.id))) continue
    points.push({
      id: String(n.id),
      lat: n.lat,
      lng: n.lon,
      maxspeed: tags.maxspeed ? String(tags.maxspeed) : undefined,
      kind: "fixed",
    })
  }

  // Section gate cameras as exact icons too
  for (const s of sections) {
    for (const d of s.devices) points.push(d)
  }

  const result: RadarData = { points, sections }
  cache.set(key, result)
  if (cache.size > 40) {
    const first = cache.keys().next().value
    if (first != null) cache.delete(first)
  }
  return result
}

export function bboxAround(center: LatLng, radiusKm = 12) {
  const dLat = radiusKm / 111
  const dLng = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180) || 1)
  return {
    south: center.lat - dLat,
    west: center.lng - dLng,
    north: center.lat + dLat,
    east: center.lng + dLng,
  }
}
