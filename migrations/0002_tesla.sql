-- Tesla Fleet API connection + logged history for Live Data / Stats

CREATE TABLE tesla_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE tesla_accounts (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  api_base TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE tesla_vehicles (
  vin TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  display_name TEXT,
  car_type TEXT,
  state TEXT,
  last_data TEXT,
  last_data_at INTEGER,
  next_poll_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX tesla_vehicles_user ON tesla_vehicles(user_id);
CREATE INDEX tesla_vehicles_poll ON tesla_vehicles(next_poll_at);

CREATE TABLE tesla_snapshots (
  vin TEXT NOT NULL,
  ts INTEGER NOT NULL,
  shift_state TEXT,
  speed REAL,
  power REAL,
  odometer REAL,
  battery_level REAL,
  battery_range REAL,
  charging_state TEXT,
  charger_power REAL,
  charge_energy_added REAL,
  lat REAL,
  lng REAL,
  inside_temp REAL,
  outside_temp REAL,
  PRIMARY KEY (vin, ts)
);

CREATE TABLE tesla_drives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  open INTEGER NOT NULL DEFAULT 1,
  start_odometer REAL,
  end_odometer REAL,
  start_level REAL,
  end_level REAL,
  start_range REAL,
  end_range REAL,
  max_speed REAL,
  max_power REAL,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL
);

CREATE INDEX tesla_drives_vin ON tesla_drives(vin, start_ts);

CREATE TABLE tesla_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  open INTEGER NOT NULL DEFAULT 1,
  start_level REAL,
  end_level REAL,
  start_range REAL,
  end_range REAL,
  energy_added REAL,
  max_power REAL,
  fast_charger INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL
);

CREATE INDEX tesla_charges_vin ON tesla_charges(vin, start_ts);
