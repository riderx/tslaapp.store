import type { Env, UserRow } from './types'
import { json } from './auth'

/**
 * Tesla Fleet API integration.
 *
 * - OAuth (authorization code) links a Tesla account to a tslap user.
 * - A cron poller logs vehicle snapshots and folds them into drives / charges (Stats).
 * - The in-car Live Data view polls /live, which also feeds the same log at higher resolution.
 *
 * Fleet API requests are billed by Tesla, so polling is adaptive and the live endpoint is cached.
 */

const AUTH_URL = 'https://auth.tesla.com/oauth2/v3/authorize'
const TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'
const DEFAULT_API_BASE = 'https://fleet-api.prd.na.vn.cloud.tesla.com'
const SCOPES = 'openid offline_access user_data vehicle_device_data vehicle_location'
const DATA_ENDPOINTS = 'charge_state;climate_state;drive_state;gui_settings;location_data;vehicle_state;vehicle_config'

const MIN = 60_000
const POLL_DRIVING = 1 * MIN
const POLL_CHARGING = 5 * MIN
const POLL_IDLE = 15 * MIN // long gap lets the car fall asleep
const POLL_ASLEEP = 10 * MIN
const LIVE_CACHE_MS = 4_000
const SNAPSHOT_MIN_GAP_MS = 10_000
const SNAPSHOT_RETENTION_MS = 90 * 24 * 60 * MIN

type TeslaAccountRow = {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: number
  api_base: string
}

type TeslaVehicleRow = {
  vin: string
  user_id: string
  vehicle_id: string
  display_name: string | null
  car_type: string | null
  state: string | null
  last_data: string | null
  last_data_at: number | null
  next_poll_at: number
}

type SnapshotRow = {
  ts: number
  shift_state: string | null
  speed: number | null
  power: number | null
  odometer: number | null
  battery_level: number | null
  battery_range: number | null
  charging_state: string | null
  charger_power: number | null
  charge_energy_added: number | null
  lat: number | null
  lng: number | null
  inside_temp: number | null
  outside_temp: number | null
}

export function teslaConfigured(env: Env) {
  return Boolean(env.TESLA_CLIENT_ID && env.TESLA_CLIENT_SECRET)
}

class TeslaError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Token storage (AES-GCM at rest when TESLA_TOKEN_KEY is set)

async function tokenKey(env: Env): Promise<CryptoKey | null> {
  if (!env.TESLA_TOKEN_KEY) return null
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.TESLA_TOKEN_KEY))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function b64(bytes: Uint8Array) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function seal(env: Env, value: string) {
  const key = await tokenKey(env)
  if (!key) return value
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value))
  return `enc:${b64(iv)}:${b64(new Uint8Array(ct))}`
}

async function unseal(env: Env, value: string) {
  if (!value.startsWith('enc:')) return value
  const key = await tokenKey(env)
  if (!key) throw new TeslaError('TESLA_TOKEN_KEY missing', 500)
  const [, iv, ct] = value.split(':')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct))
  return new TextDecoder().decode(pt)
}

// ---------------------------------------------------------------------------
// OAuth

async function tokenRequest(env: Env, params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const data = await res.json<{
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }>()
  if (!res.ok || !data.access_token) {
    throw new TeslaError(data.error_description || data.error || `Tesla auth failed (${res.status})`, 401)
  }
  return data as { access_token: string; refresh_token: string; expires_in: number }
}

async function saveAccount(
  env: Env,
  userId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  apiBase: string,
) {
  await env.DB.prepare(
    `INSERT INTO tesla_accounts (user_id, access_token, refresh_token, expires_at, api_base, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       api_base = excluded.api_base`,
  )
    .bind(
      userId,
      await seal(env, tokens.access_token),
      await seal(env, tokens.refresh_token),
      Date.now() + tokens.expires_in * 1000,
      apiBase,
      Date.now(),
    )
    .run()
}

async function accessToken(env: Env, account: TeslaAccountRow): Promise<string> {
  if (account.expires_at - Date.now() > 5 * MIN) return unseal(env, account.access_token)
  const tokens = await tokenRequest(env, {
    grant_type: 'refresh_token',
    client_id: env.TESLA_CLIENT_ID!,
    refresh_token: await unseal(env, account.refresh_token),
  })
  await saveAccount(env, account.user_id, tokens, account.api_base)
  account.expires_at = Date.now() + tokens.expires_in * 1000
  return tokens.access_token
}

async function fleet<T>(env: Env, account: TeslaAccountRow, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(env, account)
  const res = await fetch(account.api_base + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const data = await res.json<{ response?: T; error?: string }>().catch(() => ({}) as { error?: string })
  if (!res.ok) {
    throw new TeslaError((data as { error?: string }).error || `Tesla API ${res.status}`, res.status)
  }
  return (data as { response: T }).response
}

function redirectUri(env: Env, request: Request) {
  return env.TESLA_REDIRECT_URI || `${new URL(request.url).origin}/api/tesla/callback`
}

/** OAuth redirect target (browser navigation, not bearer-authenticated). */
export async function handleTeslaCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const back = (q: string) => Response.redirect(`${url.origin}/live-data?tesla=${q}`, 302)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return back(url.searchParams.get('error') || 'error')

  const row = await env.DB.prepare('SELECT * FROM tesla_oauth_states WHERE state = ?')
    .bind(state)
    .first<{ user_id: string; created_at: number }>()
  await env.DB.prepare('DELETE FROM tesla_oauth_states WHERE state = ? OR created_at < ?')
    .bind(state, Date.now() - 30 * MIN)
    .run()
  if (!row || Date.now() - row.created_at > 30 * MIN) return back('expired')

  try {
    const tokens = await tokenRequest(env, {
      grant_type: 'authorization_code',
      client_id: env.TESLA_CLIENT_ID!,
      client_secret: env.TESLA_CLIENT_SECRET!,
      code,
      audience: DEFAULT_API_BASE,
      redirect_uri: redirectUri(env, request),
    })
    // Accounts live in one region; ask Tesla which base URL to use.
    let apiBase = DEFAULT_API_BASE
    try {
      const res = await fetch(`${DEFAULT_API_BASE}/api/1/users/region`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      const data = await res.json<{ response?: { fleet_api_base_url?: string } }>()
      if (data.response?.fleet_api_base_url) apiBase = data.response.fleet_api_base_url
    } catch {
      // keep default
    }
    await saveAccount(env, row.user_id, tokens, apiBase)
    const account = await getAccount(env, row.user_id)
    if (account) await syncVehicles(env, account)
    return back('connected')
  } catch (err) {
    console.error('tesla callback', err)
    return back('error')
  }
}

async function getAccount(env: Env, userId: string) {
  return env.DB.prepare('SELECT * FROM tesla_accounts WHERE user_id = ?').bind(userId).first<TeslaAccountRow>()
}

type FleetVehicle = { id: number; id_s?: string; vin: string; display_name: string | null; state: string }

async function syncVehicles(env: Env, account: TeslaAccountRow) {
  const list = await fleet<FleetVehicle[]>(env, account, '/api/1/vehicles')
  const now = Date.now()
  await env.DB.batch(
    list.map((v) =>
      env.DB.prepare(
        `INSERT INTO tesla_vehicles (vin, user_id, vehicle_id, display_name, state, next_poll_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(vin) DO UPDATE SET
           user_id = excluded.user_id,
           vehicle_id = excluded.vehicle_id,
           display_name = excluded.display_name,
           state = excluded.state,
           next_poll_at = 0`,
      ).bind(v.vin, account.user_id, v.id_s || String(v.id), v.display_name, v.state, now),
    ),
  )
  return list
}

// ---------------------------------------------------------------------------
// Snapshots → drives / charges

type VehicleData = {
  state?: string
  display_name?: string
  charge_state?: Record<string, any>
  climate_state?: Record<string, any>
  drive_state?: Record<string, any>
  vehicle_state?: Record<string, any>
  vehicle_config?: Record<string, any>
}

function toSnapshot(data: VehicleData, ts: number): SnapshotRow {
  const d = data.drive_state || {}
  const c = data.charge_state || {}
  const cl = data.climate_state || {}
  const v = data.vehicle_state || {}
  return {
    ts,
    shift_state: d.shift_state ?? null,
    speed: d.speed ?? null,
    power: d.power ?? null,
    odometer: v.odometer ?? null,
    battery_level: c.battery_level ?? null,
    battery_range: c.battery_range ?? null,
    charging_state: c.charging_state ?? null,
    charger_power: c.charger_power ?? null,
    charge_energy_added: c.charge_energy_added ?? null,
    lat: d.latitude ?? d.active_route_latitude ?? null,
    lng: d.longitude ?? d.active_route_longitude ?? null,
    inside_temp: cl.inside_temp ?? null,
    outside_temp: cl.outside_temp ?? null,
  }
}

const isDriving = (s: SnapshotRow) => s.shift_state === 'D' || s.shift_state === 'R' || s.shift_state === 'N'
const isCharging = (s: SnapshotRow) => s.charging_state === 'Charging' || s.charging_state === 'Starting'

export async function recordSnapshot(env: Env, vehicle: TeslaVehicleRow, data: VehicleData) {
  const ts = Date.now()
  const snap = toSnapshot(data, ts)
  const prev = await env.DB.prepare('SELECT * FROM tesla_snapshots WHERE vin = ? ORDER BY ts DESC LIMIT 1')
    .bind(vehicle.vin)
    .first<SnapshotRow>()

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE tesla_vehicles SET last_data = ?, last_data_at = ?, state = 'online', car_type = COALESCE(?, car_type),
         display_name = COALESCE(?, display_name)
       WHERE vin = ?`,
    ).bind(JSON.stringify(data), ts, data.vehicle_config?.car_type ?? null, data.display_name ?? null, vehicle.vin),
  ]

  if (!prev || ts - prev.ts >= SNAPSHOT_MIN_GAP_MS) {
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO tesla_snapshots (vin, ts, shift_state, speed, power, odometer, battery_level, battery_range,
           charging_state, charger_power, charge_energy_added, lat, lng, inside_temp, outside_temp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        vehicle.vin,
        snap.ts,
        snap.shift_state,
        snap.speed,
        snap.power,
        snap.odometer,
        snap.battery_level,
        snap.battery_range,
        snap.charging_state,
        snap.charger_power,
        snap.charge_energy_added,
        snap.lat,
        snap.lng,
        snap.inside_temp,
        snap.outside_temp,
      ),
    )
  }

  // A recent parked snapshot is a better session start than the first one we caught mid-drive.
  const startFrom = prev && ts - prev.ts < 6 * 60 * MIN ? prev : snap

  const openDrive = await env.DB.prepare('SELECT id FROM tesla_drives WHERE vin = ? AND open = 1')
    .bind(vehicle.vin)
    .first<{ id: number }>()
  if (isDriving(snap)) {
    if (openDrive) {
      stmts.push(
        env.DB.prepare(
          `UPDATE tesla_drives SET end_ts = ?, end_odometer = COALESCE(?, end_odometer), end_level = COALESCE(?, end_level),
             end_range = COALESCE(?, end_range), end_lat = COALESCE(?, end_lat), end_lng = COALESCE(?, end_lng),
             max_speed = MAX(COALESCE(max_speed, 0), COALESCE(?, 0)), max_power = MAX(COALESCE(max_power, 0), COALESCE(?, 0))
           WHERE id = ?`,
        ).bind(ts, snap.odometer, snap.battery_level, snap.battery_range, snap.lat, snap.lng, snap.speed, snap.power, openDrive.id),
      )
    } else {
      const start = isDriving(startFrom) ? snap : startFrom
      stmts.push(
        env.DB.prepare(
          `INSERT INTO tesla_drives (vin, start_ts, end_ts, start_odometer, end_odometer, start_level, end_level,
             start_range, end_range, max_speed, max_power, start_lat, start_lng, end_lat, end_lng)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          vehicle.vin,
          start.ts,
          ts,
          start.odometer,
          snap.odometer,
          start.battery_level,
          snap.battery_level,
          start.battery_range,
          snap.battery_range,
          snap.speed ?? 0,
          snap.power ?? 0,
          start.lat,
          start.lng,
          snap.lat,
          snap.lng,
        ),
      )
    }
  } else if (openDrive) {
    stmts.push(
      env.DB.prepare(
        `UPDATE tesla_drives SET open = 0, end_ts = ?, end_odometer = COALESCE(?, end_odometer),
           end_level = COALESCE(?, end_level), end_range = COALESCE(?, end_range),
           end_lat = COALESCE(?, end_lat), end_lng = COALESCE(?, end_lng)
         WHERE id = ?`,
      ).bind(ts, snap.odometer, snap.battery_level, snap.battery_range, snap.lat, snap.lng, openDrive.id),
    )
  }

  const openCharge = await env.DB.prepare('SELECT id FROM tesla_charges WHERE vin = ? AND open = 1')
    .bind(vehicle.vin)
    .first<{ id: number }>()
  const fast = data.charge_state?.fast_charger_present ? 1 : 0
  if (isCharging(snap)) {
    if (openCharge) {
      stmts.push(
        env.DB.prepare(
          `UPDATE tesla_charges SET end_ts = ?, end_level = COALESCE(?, end_level), end_range = COALESCE(?, end_range),
             energy_added = MAX(COALESCE(energy_added, 0), COALESCE(?, 0)),
             max_power = MAX(COALESCE(max_power, 0), COALESCE(?, 0)), fast_charger = MAX(fast_charger, ?)
           WHERE id = ?`,
        ).bind(ts, snap.battery_level, snap.battery_range, snap.charge_energy_added, snap.charger_power, fast, openCharge.id),
      )
    } else {
      const start = isCharging(startFrom) ? snap : startFrom
      stmts.push(
        env.DB.prepare(
          `INSERT INTO tesla_charges (vin, start_ts, end_ts, start_level, end_level, start_range, end_range,
             energy_added, max_power, fast_charger, lat, lng)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          vehicle.vin,
          start.ts,
          ts,
          start.battery_level,
          snap.battery_level,
          start.battery_range,
          snap.battery_range,
          snap.charge_energy_added ?? 0,
          snap.charger_power ?? 0,
          fast,
          snap.lat,
          snap.lng,
        ),
      )
    }
  } else if (openCharge) {
    // charge_energy_added stays populated after charging stops, so take the final figure here
    stmts.push(
      env.DB.prepare(
        `UPDATE tesla_charges SET open = 0, end_ts = ?, end_level = COALESCE(?, end_level),
           end_range = COALESCE(?, end_range), energy_added = MAX(COALESCE(energy_added, 0), COALESCE(?, 0))
         WHERE id = ?`,
      ).bind(ts, snap.battery_level, snap.battery_range, snap.charge_energy_added, openCharge.id),
    )
  }

  await env.DB.batch(stmts)
  return snap
}

function nextPollDelay(snap: SnapshotRow) {
  if (isDriving(snap)) return POLL_DRIVING
  if (isCharging(snap)) return POLL_CHARGING
  return POLL_IDLE
}

async function setVehicleState(env: Env, vin: string, state: string, nextPollAt: number) {
  await env.DB.prepare('UPDATE tesla_vehicles SET state = ?, next_poll_at = ? WHERE vin = ?')
    .bind(state, nextPollAt, vin)
    .run()
}

/** Fetch fresh vehicle_data. Asleep/offline cars are not woken unless `wake` is set. */
async function pollVehicle(env: Env, account: TeslaAccountRow, vehicle: TeslaVehicleRow, wake = false) {
  if (wake) {
    await fleet(env, account, `/api/1/vehicles/${vehicle.vin}/wake_up`, { method: 'POST' })
  }
  try {
    const data = await fleet<VehicleData>(
      env,
      account,
      `/api/1/vehicles/${vehicle.vin}/vehicle_data?endpoints=${encodeURIComponent(DATA_ENDPOINTS)}`,
    )
    const snap = await recordSnapshot(env, vehicle, data)
    await env.DB.prepare('UPDATE tesla_vehicles SET next_poll_at = ? WHERE vin = ?')
      .bind(Date.now() + nextPollDelay(snap), vehicle.vin)
      .run()
    return { state: 'online', data, at: Date.now() }
  } catch (err) {
    // 408 = vehicle asleep / unavailable
    if (err instanceof TeslaError && err.status === 408) {
      await setVehicleState(env, vehicle.vin, 'asleep', Date.now() + POLL_ASLEEP)
      return { state: 'asleep', data: vehicle.last_data ? JSON.parse(vehicle.last_data) : null, at: vehicle.last_data_at }
    }
    throw err
  }
}

/** Cron entry: poll every vehicle whose next_poll_at is due. */
export async function pollDueVehicles(env: Env) {
  if (!teslaConfigured(env)) return
  const now = Date.now()
  const due = await env.DB.prepare(
    'SELECT * FROM tesla_vehicles WHERE next_poll_at <= ? ORDER BY next_poll_at LIMIT 40',
  )
    .bind(now)
    .all<TeslaVehicleRow>()
  const accounts = new Map<string, TeslaAccountRow | null>()

  await Promise.all(
    (due.results || []).map(async (vehicle) => {
      try {
        if (!accounts.has(vehicle.user_id)) accounts.set(vehicle.user_id, await getAccount(env, vehicle.user_id))
        const account = accounts.get(vehicle.user_id)
        if (!account) {
          await setVehicleState(env, vehicle.vin, 'disconnected', now + 24 * 60 * MIN)
          return
        }
        // Cheap state check first — listing a vehicle never wakes it.
        const summary = await fleet<FleetVehicle>(env, account, `/api/1/vehicles/${vehicle.vin}`)
        if (summary.state !== 'online') {
          await closeOpenSessions(env, vehicle.vin)
          await setVehicleState(env, vehicle.vin, summary.state, now + POLL_ASLEEP)
          return
        }
        await pollVehicle(env, account, vehicle)
      } catch (err) {
        console.error('tesla poll', vehicle.vin, err)
        const status = err instanceof TeslaError ? err.status : 0
        // Revoked tokens: stop hammering until the user reconnects.
        const delay = status === 401 || status === 403 ? 6 * 60 * MIN : POLL_ASLEEP
        await setVehicleState(env, vehicle.vin, status === 401 ? 'reauth' : vehicle.state || 'unknown', now + delay)
      }
    }),
  )

  // Hourly retention sweep
  if (new Date(now).getUTCMinutes() === 0) {
    await env.DB.prepare('DELETE FROM tesla_snapshots WHERE ts < ?').bind(now - SNAPSHOT_RETENTION_MS).run()
  }
}

/** A sleeping car is neither driving nor charging. */
async function closeOpenSessions(env: Env, vin: string) {
  await env.DB.batch([
    env.DB.prepare('UPDATE tesla_drives SET open = 0 WHERE vin = ? AND open = 1').bind(vin),
    env.DB.prepare('UPDATE tesla_charges SET open = 0 WHERE vin = ? AND open = 1').bind(vin),
  ])
}

// ---------------------------------------------------------------------------
// Stats

const PACK_KWH: Record<string, number> = {
  model3: 75,
  modely: 75,
  models: 95,
  models2: 95,
  modelx: 95,
  modelx2: 95,
  cybertruck: 123,
}

export async function computeStats(env: Env, vehicle: TeslaVehicleRow, days: number) {
  const since = Date.now() - days * 24 * 60 * MIN
  const bucket = Math.max(5 * MIN, Math.floor((days * 24 * 60 * MIN) / 200))
  const [drives, charges, history, learn] = await Promise.all([
    env.DB.prepare('SELECT * FROM tesla_drives WHERE vin = ? AND start_ts >= ? ORDER BY start_ts DESC')
      .bind(vehicle.vin, since)
      .all<Record<string, any>>(),
    env.DB.prepare('SELECT * FROM tesla_charges WHERE vin = ? AND start_ts >= ? ORDER BY start_ts DESC')
      .bind(vehicle.vin, since)
      .all<Record<string, any>>(),
    // ~200 points of battery history regardless of window size
    env.DB.prepare(
      `SELECT CAST(ts / ?1 AS INTEGER) * ?1 AS t, AVG(battery_level) AS level, AVG(battery_range) AS range
       FROM tesla_snapshots WHERE vin = ?2 AND ts >= ?3 AND battery_level IS NOT NULL
       GROUP BY t ORDER BY t`,
    )
      .bind(bucket, vehicle.vin, since)
      .all<{ t: number; level: number; range: number }>(),
    // Charges with a big SoC swing let us learn the real usable pack size.
    env.DB.prepare(
      `SELECT energy_added, end_level - start_level AS delta FROM tesla_charges
       WHERE vin = ? AND open = 0 AND energy_added > 5 AND end_level - start_level >= 15
       ORDER BY start_ts DESC LIMIT 20`,
    )
      .bind(vehicle.vin)
      .all<{ energy_added: number; delta: number }>(),
  ])

  const estimates = (learn.results || []).map((r) => (r.energy_added / r.delta) * 100).sort((a, b) => a - b)
  const packKwh = estimates.length
    ? estimates[Math.floor(estimates.length / 2)]
    : PACK_KWH[vehicle.car_type || ''] || 75

  const driveList = (drives.results || []).map((d) => {
    const distance = Math.max(0, (d.end_odometer ?? 0) - (d.start_odometer ?? 0))
    const levelUsed = Math.max(0, (d.start_level ?? 0) - (d.end_level ?? 0))
    const energy = (levelUsed / 100) * packKwh
    return {
      id: d.id,
      start: d.start_ts,
      end: d.end_ts,
      open: Boolean(d.open),
      distance, // miles
      energy, // kWh (estimated from SoC)
      startLevel: d.start_level,
      endLevel: d.end_level,
      maxSpeed: d.max_speed, // mph
      maxPower: d.max_power, // kW
      from: d.start_lat != null ? { lat: d.start_lat, lng: d.start_lng } : null,
      to: d.end_lat != null ? { lat: d.end_lat, lng: d.end_lng } : null,
    }
  })

  const chargeList = (charges.results || []).map((c) => ({
    id: c.id,
    start: c.start_ts,
    end: c.end_ts,
    open: Boolean(c.open),
    startLevel: c.start_level,
    endLevel: c.end_level,
    energy: c.energy_added ?? 0,
    maxPower: c.max_power ?? 0,
    fast: Boolean(c.fast_charger),
    location: c.lat != null ? { lat: c.lat, lng: c.lng } : null,
  }))

  const daily: Record<string, { day: string; distance: number; energy: number; charged: number }> = {}
  const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10)
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(Date.now() - i * 24 * 60 * MIN)
    daily[key] = { day: key, distance: 0, energy: 0, charged: 0 }
  }
  for (const d of driveList) {
    const k = daily[dayKey(d.start)]
    if (k) {
      k.distance += d.distance
      k.energy += d.energy
    }
  }
  for (const c of chargeList) {
    const k = daily[dayKey(c.start)]
    if (k) k.charged += c.energy
  }

  const distance = driveList.reduce((s, d) => s + d.distance, 0)
  const energy = driveList.reduce((s, d) => s + d.energy, 0)
  return {
    days,
    packKwh: Math.round(packKwh * 10) / 10,
    packLearned: estimates.length > 0,
    totals: {
      drives: driveList.length,
      distance,
      energy,
      whPerMile: distance > 1 ? (energy * 1000) / distance : null,
      driveTimeMs: driveList.reduce((s, d) => s + (d.end - d.start), 0),
      charges: chargeList.length,
      charged: chargeList.reduce((s, c) => s + c.energy, 0),
      fastCharged: chargeList.filter((c) => c.fast).reduce((s, c) => s + c.energy, 0),
      maxSpeed: driveList.reduce((m, d) => Math.max(m, d.maxSpeed ?? 0), 0),
    },
    daily: Object.values(daily),
    battery: (history.results || []).map((h) => ({ t: h.t, level: h.level, range: h.range })),
    drives: driveList.slice(0, 50),
    charges: chargeList.slice(0, 50),
  }
}

// ---------------------------------------------------------------------------
// HTTP API (bearer-authenticated tslap user)

function vehicleView(v: TeslaVehicleRow) {
  return {
    vin: v.vin,
    name: v.display_name || 'Tesla',
    carType: v.car_type,
    state: v.state,
    lastDataAt: v.last_data_at,
  }
}

async function ownedVehicle(env: Env, userId: string, vin: string) {
  return env.DB.prepare('SELECT * FROM tesla_vehicles WHERE vin = ? AND user_id = ?')
    .bind(vin, userId)
    .first<TeslaVehicleRow>()
}

export async function handleTeslaApi(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  user: UserRow,
): Promise<Response> {
  if (path === '/api/tesla/status' && request.method === 'GET') {
    const account = await getAccount(env, user.id)
    const vehicles = await env.DB.prepare('SELECT * FROM tesla_vehicles WHERE user_id = ? ORDER BY created_at')
      .bind(user.id)
      .all<TeslaVehicleRow>()
    return json({
      configured: teslaConfigured(env),
      connected: Boolean(account),
      vehicles: (vehicles.results || []).map(vehicleView),
    })
  }

  if (!teslaConfigured(env)) return json({ error: 'Tesla Fleet API is not configured on the server' }, 503)

  if (path === '/api/tesla/connect' && request.method === 'POST') {
    const state = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO tesla_oauth_states (state, user_id, created_at) VALUES (?, ?, ?)')
      .bind(state, user.id, Date.now())
      .run()
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.TESLA_CLIENT_ID!,
      redirect_uri: redirectUri(env, request),
      scope: SCOPES,
      state,
      prompt_missing_scopes: 'true',
    })
    return json({ url: `${AUTH_URL}?${params}` })
  }

  if (path === '/api/tesla/disconnect' && request.method === 'POST') {
    const vins = await env.DB.prepare('SELECT vin FROM tesla_vehicles WHERE user_id = ?')
      .bind(user.id)
      .all<{ vin: string }>()
    const stmts = [
      env.DB.prepare('DELETE FROM tesla_accounts WHERE user_id = ?').bind(user.id),
      env.DB.prepare('DELETE FROM tesla_vehicles WHERE user_id = ?').bind(user.id),
    ]
    for (const { vin } of vins.results || []) {
      stmts.push(
        env.DB.prepare('DELETE FROM tesla_snapshots WHERE vin = ?').bind(vin),
        env.DB.prepare('DELETE FROM tesla_drives WHERE vin = ?').bind(vin),
        env.DB.prepare('DELETE FROM tesla_charges WHERE vin = ?').bind(vin),
      )
    }
    await env.DB.batch(stmts)
    return json({ ok: true })
  }

  const account = await getAccount(env, user.id)
  if (!account) return json({ error: 'Tesla account not connected' }, 409)

  try {
    if (path === '/api/tesla/vehicles/sync' && request.method === 'POST') {
      await syncVehicles(env, account)
      const vehicles = await env.DB.prepare('SELECT * FROM tesla_vehicles WHERE user_id = ? ORDER BY created_at')
        .bind(user.id)
        .all<TeslaVehicleRow>()
      return json({ vehicles: (vehicles.results || []).map(vehicleView) })
    }

    const m = path.match(/^\/api\/tesla\/vehicles\/([A-Za-z0-9]+)\/(live|stats|wake)$/)
    if (m) {
      const vehicle = await ownedVehicle(env, user.id, m[1])
      if (!vehicle) return json({ error: 'Vehicle not found' }, 404)

      if (m[2] === 'live' && request.method === 'GET') {
        // Share one Fleet API call between rapid refreshes / multiple screens.
        if (vehicle.last_data && vehicle.last_data_at && Date.now() - vehicle.last_data_at < LIVE_CACHE_MS) {
          return json({ state: vehicle.state, data: JSON.parse(vehicle.last_data), at: vehicle.last_data_at })
        }
        return json(await pollVehicle(env, account, vehicle))
      }

      if (m[2] === 'wake' && request.method === 'POST') {
        return json(await pollVehicle(env, account, vehicle, true).catch(() => ({ state: 'waking' })))
      }

      if (m[2] === 'stats' && request.method === 'GET') {
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30))
        return json(await computeStats(env, vehicle, days))
      }
    }
  } catch (err) {
    const status = err instanceof TeslaError ? err.status : 502
    const message = err instanceof Error ? err.message : 'Tesla request failed'
    // Never surface Tesla's 401 as ours — the client would treat it as a lost tslap session.
    if (status === 401) return json({ error: 'Tesla login expired — reconnect', reauth: true }, 409)
    return json({ error: message }, status >= 500 ? 502 : status)
  }

  return json({ error: 'Not found' }, 404)
}

/** Public key Tesla fetches during partner registration (only needed for the domain check). */
export function teslaPublicKey(env: Env): Response {
  if (!env.TESLA_PUBLIC_KEY) return new Response('Not found', { status: 404 })
  return new Response(env.TESLA_PUBLIC_KEY.replace(/\\n/g, '\n'), {
    headers: { 'Content-Type': 'application/x-pem-file' },
  })
}
