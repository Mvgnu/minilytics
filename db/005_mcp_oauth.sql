CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id text PRIMARY KEY,
  client_name text NOT NULL,
  redirect_uris text[] NOT NULL,
  token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (token_endpoint_auth_method = 'none')
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expiry_idx
  ON mcp_oauth_codes (expires_at);

CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  token_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  token_kind text NOT NULL,
  token_family text NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (token_kind IN ('access', 'refresh'))
);

CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_lookup_idx
  ON mcp_oauth_tokens (token_hash, token_kind, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_family_idx
  ON mcp_oauth_tokens (token_family);
