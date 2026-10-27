CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  asset TEXT NOT NULL DEFAULT 'bitcoin',
  currency TEXT NOT NULL DEFAULT 'usd',
  interval_minutes INTEGER NOT NULL DEFAULT 5,
  alert_above REAL,
  alert_below REAL,
  change_alert_pct REAL NOT NULL DEFAULT 3,
  ai_analysis INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (id, enabled, asset, currency, interval_minutes, change_alert_pct, ai_analysis, updated_at)
VALUES (1, 0, 'bitcoin', 'usd', 5, 3, 1, datetime('now'));

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  change_24h REAL,
  high_24h REAL,
  low_24h REAL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_asset_time ON snapshots(asset, fetched_at DESC);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT,
  regime TEXT,
  signals_json TEXT,
  risks_json TEXT,
  next_watch_json TEXT,
  confidence TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL
);
