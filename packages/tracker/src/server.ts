export type ProxyOptions = {
  collectorUrl: string;
  siteId: string;
  siteSecret: string;
  networkVisitors?: boolean;
  visitorRotationHours?: number;
  filterBots?: boolean;
};

const MAX_BODY_BYTES = 16_384;
const DEFAULT_ROTATION_HOURS = 24;

async function readBodyWithLimit(request: Request, maxBytes = MAX_BODY_BYTES) {
  if (!request.body) return { body: "", tooLarge: false };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return { body: "", tooLarge: true };
    }
    body += decoder.decode(value, { stream: true });
  }

  body += decoder.decode();
  return { body, tooLarge: false };
}

function requestIp(request: Request) {
  const direct =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-vercel-forwarded-for");

  if (direct) return direct.trim().slice(0, 128);

  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "";
  return forwarded.split(",")[0]?.trim().slice(0, 128) || "";
}

function isLikelyBot(userAgent: string) {
  return /bot\b|crawler|spider|headless|slurp|facebookexternalhit|preview|uptime|monitoring/i.test(
    userAgent,
  );
}

async function networkVisitorId(input: {
  request: Request;
  siteId: string;
  siteSecret: string;
  rotationHours: number;
  userAgent: string;
}) {
  const ip = requestIp(input.request);
  if (!ip || !input.userAgent) return "";

  const rotationMs = Math.max(1, input.rotationHours) * 60 * 60 * 1000;
  const bucket = Math.floor(Date.now() / rotationMs);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.siteSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${input.siteId}\0${bucket}\0${ip}\0${input.userAgent}`),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function createMinilyticsProxy(options: ProxyOptions) {
  return async function POST(request: Request) {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }

    const { body: rawBody, tooLarge } = await readBodyWithLimit(request);
    if (tooLarge) return new Response(null, { status: 413 });
    if (!rawBody) return new Response(null, { status: 400 });

    const userAgent = request.headers.get("user-agent") || "";
    if ((options.filterBots ?? true) && userAgent && isLikelyBot(userAgent)) {
      return new Response(null, { status: 204 });
    }

    let body = rawBody;
    if (options.networkVisitors ?? true) {
      try {
        const payload = JSON.parse(rawBody) as Record<string, unknown>;
        const visitorId = await networkVisitorId({
          request,
          siteId: options.siteId,
          siteSecret: options.siteSecret,
          rotationHours: options.visitorRotationHours ?? DEFAULT_ROTATION_HOURS,
          userAgent,
        });
        if (visitorId) payload.visitorId = visitorId;
        body = JSON.stringify(payload);
      } catch {
        return new Response(null, { status: 400 });
      }
    }

    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }

    const headers = new Headers({
      "content-type": "application/json",
      "x-minilytics-site": options.siteId,
      "x-minilytics-secret": options.siteSecret,
    });

    const country =
      request.headers.get("x-vercel-ip-country") ||
      request.headers.get("cf-ipcountry");

    if (userAgent) headers.set("x-minilytics-user-agent", userAgent);
    if (country) headers.set("x-minilytics-country", country);

    const response = await fetch(options.collectorUrl, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    });

    return new Response(null, { status: response.ok ? 204 : 502 });
  };
}
