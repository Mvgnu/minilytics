import { ingestEvent } from "../../../lib/data";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 16_384) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }

  try {
    const result = await ingestEvent(request);
    if (result.status === 204) return new Response(null, { status: 204 });
    return Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("Minilytics ingest failed", error);
    return Response.json({ error: "Collector unavailable." }, { status: 500 });
  }
}
