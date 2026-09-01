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

function firstForwardedAddress(value: string | null) {
  return value?.split(",")[0]?.trim().slice(0, 128) || "";
}

function requestIp(request: Request) {
  return (
    firstForwardedAddress(request.headers.get("cf-connecting-ip")) ||
    firstForwardedAddress(request.headers.get("x-real-ip")) ||
    firstForwardedAddress(request.headers.get("x-vercel-forwarded-for")) ||
    firstForwardedAddress(request.headers.get("x-forwarded-for"))
  );
}

function isLikelyBot(userAgent: string) {
  return /bot\b|crawler|spider|headless|slurp|facebookexternalhit|preview|uptime|monitoring/i.test(
    userAgent,
  );
}

function parsePayload(rawBody: string) {
  try {
    const value = JSON.parse(rawBody) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createMinilyticsProxy(options: ProxyOptions) {
  const encoder = new TextEncoder();
  let hmacKeyPromise: Promise<CryptoKey> | undefined;

  function hmacKey() {
    hmacKeyPromise ??= crypto.subtle.importKey(
      "raw",
      encoder.encode(options.siteSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return hmacKeyPromise;
  }

  async function networkVisitorId(request: Request, userAgent: string) {
    const ip = requestIp(request);
    if (!ip || !userAgent) return "";

    const rotationHours = Math.max(
      1,
      options.visitorRotationHours ?? DEFAULT_ROTATION_HOURS,
    );
    const rotationMs = rotationHours * 60 * 60 * 1000;
    const bucket = Math.floor(Date.now() / rotationMs);
    const signature = await crypto.subtle.sign(
      "HMAC",
      await hmacKey(),
      encoder.encode(`${options.siteId}\0${bucket}\0${ip}\0${userAgent}`),
    );

    return Array.from(new Uint8Array(signature))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  }

  return async function POST(request: Request) {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }

    const { body: rawBody, tooLarge } = await readBodyWithLimit(request);
    if (tooLarge) return new Response(null, { status: 413 });
    if (!rawBody) return new Response(null, { status: 400 });

    const payload = parsePayload(rawBody);
    if (!payload) return new Response(null, { status: 400 });

    const userAgent = request.headers.get("user-agent") || "";
    if ((options.filterBots ?? true) && userAgent && isLikelyBot(userAgent)) {
      return new Response(null, { status: 204 });
    }

    if (options.networkVisitors ?? true) {
      const visitorId = await networkVisitorId(request, userAgent);
      if (visitorId) payload.visitorId = visitorId;
    }

    const body = JSON.stringify(payload);
    if (encoder.encode(body).byteLength > MAX_BODY_BYTES) {
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
