CREATE TABLE IF NOT EXISTS lyra_state_entities (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, id)
);

CREATE INDEX IF NOT EXISTS lyra_state_entities_kind_updated_idx ON lyra_state_entities (kind, updated_at DESC);
