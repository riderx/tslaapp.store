export type LatLng = { lat: number; lng: number }

export type PlaceResult = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

export type ManeuverType =
  | 'depart'
  | 'turn'
  | 'new name'
  | 'merge'
  | 'on ramp'
  | 'off ramp'
  | 'fork'
  | 'end of road'
  | 'continue'
  | 'roundabout'
  | 'rotary'
  | 'roundabout turn'
  | 'exit roundabout'
  | 'exit rotary'
  | 'notification'
  | 'arrive'

export type ManeuverModifier =
  | 'uturn'
  | 'sharp right'
  | 'right'
  | 'slight right'
  | 'straight'
  | 'slight left'
  | 'left'
  | 'sharp left'

export type NavStep = {
  distance: number
  duration: number
  name: string
  instruction: string
  type: ManeuverType | string
  modifier?: ManeuverModifier | string
  location: LatLng
  geometry: LatLng[]
}

export type TrafficSpeed = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM'

export type TrafficSegment = {
  speed: TrafficSpeed
  /** [lng, lat][] */
  coordinates: [number, number][]
}

export type RouteResult = {
  distance: number
  /** Preferred ETA seconds (traffic-aware when available) */
  duration: number
  /** Free-flow / static duration when provider sent it */
  durationStatic?: number
  geometry: LatLng[]
  steps: NavStep[]
  /** Live traffic coloring along the route */
  traffic?: TrafficSegment[]
  hasTraffic?: boolean
}
