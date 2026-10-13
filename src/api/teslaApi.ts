import { api } from './friendsApi'

export type TeslaVehicle = {
  vin: string
  name: string
  carType: string | null
  state: string | null
  lastDataAt: number | null
}

export type TeslaStatus = { configured: boolean; connected: boolean; vehicles: TeslaVehicle[] }

/** Raw Fleet API vehicle_data (miles, mph, °C, kW, bar). */
export type VehicleData = {
  display_name?: string
  charge_state?: Record<string, any>
  climate_state?: Record<string, any>
  drive_state?: Record<string, any>
  vehicle_state?: Record<string, any>
  vehicle_config?: Record<string, any>
  gui_settings?: Record<string, any>
}

export type LiveResponse = { state: string; data: VehicleData | null; at: number | null }

export type Drive = {
  id: number
  start: number
  end: number
  open: boolean
  distance: number
  energy: number
  startLevel: number | null
  endLevel: number | null
  maxSpeed: number | null
  maxPower: number | null
}

export type Charge = {
  id: number
  start: number
  end: number
  open: boolean
  startLevel: number | null
  endLevel: number | null
  energy: number
  maxPower: number
  fast: boolean
}

export type TeslaStats = {
  days: number
  packKwh: number
  packLearned: boolean
  totals: {
    drives: number
    distance: number
    energy: number
    whPerMile: number | null
    driveTimeMs: number
    charges: number
    charged: number
    fastCharged: number
    maxSpeed: number
  }
  daily: { day: string; distance: number; energy: number; charged: number }[]
  battery: { t: number; level: number; range: number }[]
  drives: Drive[]
  charges: Charge[]
}

export const teslaApi = {
  status: () => api<TeslaStatus>('/api/tesla/status'),
  connect: () => api<{ url: string }>('/api/tesla/connect', { method: 'POST', body: '{}' }),
  disconnect: () => api<{ ok: boolean }>('/api/tesla/disconnect', { method: 'POST', body: '{}' }),
  sync: () => api<{ vehicles: TeslaVehicle[] }>('/api/tesla/vehicles/sync', { method: 'POST', body: '{}' }),
  live: (vin: string) => api<LiveResponse>(`/api/tesla/vehicles/${vin}/live`),
  wake: (vin: string) => api<LiveResponse>(`/api/tesla/vehicles/${vin}/wake`, { method: 'POST', body: '{}' }),
  stats: (vin: string, days: number) => api<TeslaStats>(`/api/tesla/vehicles/${vin}/stats?days=${days}`),
}
