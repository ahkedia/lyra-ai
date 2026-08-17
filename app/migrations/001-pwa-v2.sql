CREATE TABLE IF NOT EXISTS lyra_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lyra_events (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL DEFAULT 'primary',
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  envelope JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS lyra_events_stream_time_idx ON lyra_events (stream_id, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS lyra_questions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES lyra_events(id),
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  definition JSONB NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipient_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  resume_context JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ,
  continuation_status TEXT NOT NULL DEFAULT 'not_ready',
  continuation_idempotency_key TEXT UNIQUE,
  continuation_attempts INTEGER NOT NULL DEFAULT 0,
  next_resume_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  legacy_question_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS lyra_deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES lyra_events(id),
  channel TEXT NOT NULL,
  target_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (event_id, channel, target_key)
);

INSERT INTO lyra_schema_migrations (version) VALUES ('001-pwa-v2') ON CONFLICT (version) DO NOTHING;
