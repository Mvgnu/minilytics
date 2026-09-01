export type ProxyOptions = {
  collectorUrl: string;
  siteId: string;
  siteSecret: string;
};

export function createMinilyticsProxy(options: ProxyOptions) {
  return async function POST(request: Request) {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 16_384) {
      return new Response(null, { status: 413 });
    }

    const body = await request.text();
    if (!body || body.length > 16_384) {
      return new Response(null, { status: 400 });
    }

    const headers = new Headers({
      "content-type": "application/json",
      "x-minilytics-site": options.siteId,
      "x-minilytics-secret": options.siteSecret,
    });

    const userAgent = request.headers.get("user-agent");
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
