import {
  oauthErrorResponse,
  revokeOAuthToken,
} from "../../../../lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const raw = form.get("token");
    if (typeof raw === "string" && raw) await revokeOAuthToken(raw.slice(0, 512));
    return new Response(null, {
      status: 200,
      headers: {
        "cache-control": "no-store",
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
