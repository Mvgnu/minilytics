import {
  exchangeAuthorizationCode,
  OAuthError,
  oauthErrorResponse,
  refreshAccessToken,
} from "../../../../lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function value(form: FormData, name: string, max = 2048) {
  const item = form.get(name);
  return typeof item === "string" ? item.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const grantType = value(form, "grant_type", 64);
    const clientId = value(form, "client_id", 256);
    if (!clientId) throw new OAuthError("invalid_request", "client_id is required.");

    let token;
    if (grantType === "authorization_code") {
      token = await exchangeAuthorizationCode({
        code: value(form, "code", 512),
        clientId,
        redirectUri: value(form, "redirect_uri", 2048),
        codeVerifier: value(form, "code_verifier", 256),
        resource: value(form, "resource", 2048) || undefined,
      });
    } else if (grantType === "refresh_token") {
      token = await refreshAccessToken({
        refreshToken: value(form, "refresh_token", 512),
        clientId,
        resource: value(form, "resource", 2048) || undefined,
      });
    } else {
      throw new OAuthError("unsupported_grant_type", "Unsupported grant type.");
    }

    return Response.json(token, {
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
        "access-control-allow-origin": "*",
      },
    });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}
