import {
  oauthErrorResponse,
  registerOAuthClient,
} from "../../../../lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 32_768) {
      return Response.json(
        { error: "invalid_client_metadata", error_description: "Metadata is too large." },
        { status: 413 },
      );
    }
    const metadata = await request.json();
    const client = await registerOAuthClient(metadata);
    return Response.json(client, {
      status: 201,
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
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}
