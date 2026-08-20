-- Beta Android signup list
CREATE TABLE IF NOT EXISTS beta_android_signups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL UNIQUE,
  ip_address  TEXT        NOT NULL DEFAULT '',
  user_agent  TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo el service role puede leer/escribir (no RLS pública)
ALTER TABLE beta_android_signups ENABLE ROW LEVEL SECURITY;
