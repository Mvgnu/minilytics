import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import postgres from "postgres";

const ACCESS_TOKEN_SECONDS = 60 * 60;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const AUTH_CODE_SECONDS = 10 * 60;
const READ_SCOPE = "analytics:read";

type Sql = ReturnType<typeof postgres>;
type OAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};
export type AuthorizationRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  state: string;
};

let oauthClient: Sql | undefined;

function db() {
  if (oauthClient) return oauthClient;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  oauthClient = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return oauthClient;
}

export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function text(value: unknown, max = 2048) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueToken(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function oauthSigningSecret() {
  const secret =
    process.env.MINILYTICS_OAUTH_SECRET || process.env.DASHBOARD_PASSWORD || "";
  if (secret.length < 16) {
    throw new Error(
      "MINILYTICS_OAUTH_SECRET must be configured with at least 16 characters.",
    );
  }
  return secret;
}

export function publicBaseUrl(request: Request) {
  const configured = process.env.MINILYTICS_PUBLIC_URL?.trim();
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

export function mcpResourceUrl(request: Request) {
  return `${publicBaseUrl(request)}/api/mcp`;
}

export function protectedResourceMetadata(request: Request) {
  const base = publicBaseUrl(request);
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: [READ_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: `${base}/mcp`,
  };
}

export function authorizationServerMetadata(request: Request) {
  const base = publicBaseUrl(request);
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: [READ_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  };
}

function validRedirectUri(raw: string) {
  try {
    const url = new URL(raw);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export async function registerOAuthClient(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OAuthError("invalid_client_metadata", "Invalid client metadata.");
  }
  const metadata = payload as Record<string, unknown>;
  const redirects = Array.isArray(metadata.redirect_uris)
    ? metadata.redirect_uris
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
    : [];
  const redirectUris = [...new Set(redirects)].slice(0, 10);
  if (!redirectUris.length || redirectUris.some((uri) => !validRedirectUri(uri))) {
    throw new OAuthError(
      "invalid_redirect_uri",
      "At least one valid HTTPS redirect URI is required.",
    );
  }

  const authMethod = text(metadata.token_endpoint_auth_method, 64) || "none";
  if (authMethod !== "none") {
    throw new OAuthError(
      "invalid_client_metadata",
      "Only public PKCE clients are supported.",
    );
  }
  const grants = Array.isArray(metadata.grant_types)
    ? metadata.grant_types.filter((value): value is string => typeof value === "string")
    : ["authorization_code", "refresh_token"];
  if (grants.some((grant) => !["authorization_code", "refresh_token"].includes(grant))) {
    throw new OAuthError("invalid_client_metadata", "Unsupported grant type.");
  }
  const responses = Array.isArray(metadata.response_types)
    ? metadata.response_types.filter((value): value is string => typeof value === "string")
    : ["code"];
  if (responses.some((response) => response !== "code")) {
    throw new OAuthError("invalid_client_metadata", "Unsupported response type.");
  }

  const clientId = opaqueToken("mlc");
  const clientName = text(metadata.client_name, 128) || "MCP client";
  const sql = db();
  await sql`
    INSERT INTO mcp_oauth_clients (
      client_id, client_name, redirect_uris, token_endpoint_auth_method
    ) VALUES (
      ${clientId}, ${clientName}, ${sql.array(redirectUris)}, 'none'
    )
  `;

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const sql = db();
  const [row] = await sql<OAuthClient[]>`
    SELECT
      client_id AS "clientId",
      client_name AS "clientName",
      redirect_uris AS "redirectUris"
    FROM mcp_oauth_clients
    WHERE client_id = ${clientId}
    LIMIT 1
  `;
  return row ?? null;
}

function normalizeScope(raw: string) {
  const scopes = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (!scopes.length) return READ_SCOPE;
  if (scopes.some((scope) => scope !== READ_SCOPE)) {
    throw new OAuthError("invalid_scope", "Only analytics:read is available.");
  }
  return READ_SCOPE;
}

export async function validateAuthorizationRequest(
  params: URLSearchParams,
  request: Request,
): Promise<AuthorizationRequest> {
  if (params.get("response_type") !== "code") {
    throw new OAuthError("unsupported_response_type", "response_type must be code.");
  }
  const clientId = text(params.get("client_id"), 256);
  const client = await getOAuthClient(clientId);
  if (!client) throw new OAuthError("invalid_request", "Unknown OAuth client.");

  const redirectUri = text(params.get("redirect_uri"), 2048);
  if (!client.redirectUris.includes(redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri is not registered.");
  }

  const codeChallenge = text(params.get("code_challenge"), 160);
  if (
    params.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)
  ) {
    throw new OAuthError("invalid_request", "S256 PKCE is required.");
  }

  const expectedResource = mcpResourceUrl(request);
  const resource = text(params.get("resource"), 2048) || expectedResource;
  if (resource !== expectedResource) {
    throw new OAuthError("invalid_target", "Unknown protected resource.");
  }

  return {
    clientId,
    clientName: client.clientName,
    redirectUri,
    codeChallenge,
    scope: normalizeScope(text(params.get("scope"), 256)),
    resource,
    state: text(params.get("state"), 2048),
  };
}

export function signAuthorizationRequest(value: AuthorizationRequest) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", oauthSigningSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAuthorizationRequest(raw: string): AuthorizationRequest {
  const [payload, signature] = raw.split(".", 2);
  if (!payload || !signature) {
    throw new OAuthError("invalid_request", "Invalid authorization request.");
  }
  const expected = createHmac("sha256", oauthSigningSecret())
    .update(payload)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    throw new OAuthError("invalid_request", "Invalid authorization request.");
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new OAuthError("invalid_request", "Invalid authorization request.");
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthorizationRequest;
  } catch {
    throw new OAuthError("invalid_request", "Invalid authorization request.");
  }
}

export async function issueAuthorizationCode(input: AuthorizationRequest) {
  const code = opaqueToken("mlcode");
  const sql = db();
  await sql`
    DELETE FROM mcp_oauth_codes WHERE expires_at < now()
  `;
  await sql`
    INSERT INTO mcp_oauth_codes (
      code_hash, client_id, redirect_uri, code_challenge,
      scope, resource, expires_at
    ) VALUES (
      ${tokenHash(code)}, ${input.clientId}, ${input.redirectUri},
      ${input.codeChallenge}, ${input.scope}, ${input.resource},
      now() + ${AUTH_CODE_SECONDS} * interval '1 second'
    )
  `;
  return code;
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function issueTokenPair(input: {
  clientId: string;
  scope: string;
  resource: string;
  family?: string;
}) {
  const accessToken = opaqueToken("mla");
  const refreshToken = opaqueToken("mlr");
  const family = input.family || opaqueToken("mlf");
  const sql = db();
  await sql`
    INSERT INTO mcp_oauth_tokens (
      token_hash, client_id, token_kind, token_family,
      scope, resource, expires_at
    ) VALUES
      (
        ${tokenHash(accessToken)}, ${input.clientId}, 'access', ${family},
        ${input.scope}, ${input.resource},
        now() + ${ACCESS_TOKEN_SECONDS} * interval '1 second'
      ),
      (
        ${tokenHash(refreshToken)}, ${input.clientId}, 'refresh', ${family},
        ${input.scope}, ${input.resource},
        now() + ${REFRESH_TOKEN_SECONDS} * interval '1 second'
      )
  `;
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refreshToken,
    scope: input.scope,
    resource: input.resource,
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource?: string;
}) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) {
    throw new OAuthError("invalid_grant", "Invalid PKCE verifier.");
  }
  const challenge = pkceChallenge(input.codeVerifier);
  const sql = db();
  const [row] = await sql<{ scope: string; resource: string }[]>`
    DELETE FROM mcp_oauth_codes
    WHERE code_hash = ${tokenHash(input.code)}
      AND client_id = ${input.clientId}
      AND redirect_uri = ${input.redirectUri}
      AND code_challenge = ${challenge}
      AND expires_at > now()
    RETURNING scope, resource
  `;
  if (!row) throw new OAuthError("invalid_grant", "Authorization code is invalid or expired.");
  if (input.resource && input.resource !== row.resource) {
    throw new OAuthError("invalid_target", "Resource does not match authorization.");
  }
  return issueTokenPair({
    clientId: input.clientId,
    scope: row.scope,
    resource: row.resource,
  });
}

export async function refreshAccessToken(input: {
  refreshToken: string;
  clientId: string;
  resource?: string;
}) {
  const sql = db();
  const [row] = await sql<{
    scope: string;
    resource: string;
    tokenFamily: string;
  }[]>`
    DELETE FROM mcp_oauth_tokens
    WHERE token_hash = ${tokenHash(input.refreshToken)}
      AND token_kind = 'refresh'
      AND client_id = ${input.clientId}
      AND revoked_at IS NULL
      AND expires_at > now()
    RETURNING scope, resource, token_family AS "tokenFamily"
  `;
  if (!row) throw new OAuthError("invalid_grant", "Refresh token is invalid or expired.");
  if (input.resource && input.resource !== row.resource) {
    throw new OAuthError("invalid_target", "Resource does not match refresh token.");
  }
  return issueTokenPair({
    clientId: input.clientId,
    scope: row.scope,
    resource: row.resource,
    family: row.tokenFamily,
  });
}

export async function revokeOAuthToken(rawToken: string) {
  const sql = db();
  const [row] = await sql<{ tokenFamily: string }[]>`
    SELECT token_family AS "tokenFamily"
    FROM mcp_oauth_tokens
    WHERE token_hash = ${tokenHash(rawToken)}
    LIMIT 1
  `;
  if (row) {
    await sql`
      UPDATE mcp_oauth_tokens
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE token_family = ${row.tokenFamily}
    `;
  }
}

export async function authenticateMcpRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return null;
  const sql = db();
  const [row] = await sql<{
    clientId: string;
    scope: string;
    resource: string;
  }[]>`
    SELECT
      client_id AS "clientId",
      scope,
      resource
    FROM mcp_oauth_tokens
    WHERE token_hash = ${tokenHash(match[1])}
      AND token_kind = 'access'
      AND revoked_at IS NULL
      AND expires_at > now()
    LIMIT 1
  `;
  if (!row) return null;
  if (row.resource !== mcpResourceUrl(request)) return null;
  if (!row.scope.split(/\s+/).includes(READ_SCOPE)) return null;
  return row;
}

export function bearerChallenge(request: Request) {
  return `Bearer resource_metadata="${publicBaseUrl(request)}/.well-known/oauth-protected-resource", scope="${READ_SCOPE}"`;
}

export function oauthErrorResponse(error: unknown) {
  const normalized =
    error instanceof OAuthError
      ? error
      : new OAuthError("server_error", "OAuth server unavailable.", 500);
  return Response.json(
    {
      error: normalized.error,
      error_description: normalized.message,
    },
    {
      status: normalized.status,
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    },
  );
}
