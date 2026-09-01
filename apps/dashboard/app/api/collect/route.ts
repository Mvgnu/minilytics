import { ingestEvent } from "../../../lib/data";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_384;

async function readBodyWithLimit(request: Request, maxBytes = MAX_BODY_BYTES) {
  if (!request.body) return { body: "", tooLarge: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return { body: "", tooLarge: true };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { body: new TextDecoder().decode(body), tooLarge: false };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }

  try {
    const { body, tooLarge } = await readBodyWithLimit(request);
    if (tooLarge) {
      return Response.json({ error: "Payload too large." }, { status: 413 });
    }
    if (!body) {
      return Response.json({ error: "Invalid JSON." }, { status: 400 });
    }

    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body,
    });

    const result = await ingestEvent(boundedRequest);
    if (result.status === 204) return new Response(null, { status: 204 });
    return Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("Minilytics ingest failed", error);
    return Response.json({ error: "Collector unavailable." }, { status: 500 });
  }
}
