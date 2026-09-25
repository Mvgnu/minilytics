import { timingSafeEqual } from "node:crypto";
import { ingestEvent } from "../../../../lib/data";
import { networkSession } from "../../../../lib/network-session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 16_384;
const empty = (status: number) => new Response(null, {status, headers: {'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
export async function POST(request: Request, {params}: {params: Promise<{siteId:string}>}) {
  const expected = process.env.MINILYTICS_EDGE_SECRET ?? '';
  const supplied = request.headers.get('x-minilytics-edge-secret') ?? '';
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) return empty(401);
  const {siteId} = await params;
  // Only explicitly configured same-origin edge integrations are accepted.
  const domains: Record<string,string> = {'srocket':'www.srocket.de','preiswert-leasen':'www.preiswert-leasen.de'};
  if (!domains[siteId]) return empty(404);
  const origin = request.headers.get('origin');
  if (origin && origin !== `https://${domains[siteId]}`) return empty(403);
  const ip = request.headers.get('x-minilytics-client-ip') ?? '';
  const ua = request.headers.get('user-agent') ?? '';
  if (!ip || !ua) return empty(400);
  if (/bot\b|crawler|spider|headless|slurp|facebookexternalhit|preview|uptime|monitoring/i.test(ua)) return empty(204);
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BYTES || !request.body) return empty(413);
  try {
    const reader=request.body.getReader();const chunks: Uint8Array[]=[];let bytes=0;
    for (;;) {const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();return empty(413);}chunks.push(next.value);}
    let payload: Record<string,unknown>;
    try { const parsed: unknown=JSON.parse(Buffer.concat(chunks).toString()); if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed))return empty(400);payload=parsed as Record<string,unknown>; } catch {return empty(400);}
    if(typeof payload.eventType !== 'string' || !/^[a-z0-9_.:-]{1,64}$/i.test(payload.eventType) || typeof payload.path !== 'string' || !payload.path.startsWith('/')) return empty(400);
    // Strip query/fragment and accept both deployed attribution payload shapes.
    payload.path=payload.path.split(/[?#]/,1)[0];
    const raw=payload.attribution && typeof payload.attribution==='object' && !Array.isArray(payload.attribution) ? payload.attribution as Record<string,unknown> : {};
    payload.attribution={landingPath:raw.landingPath ?? payload.path, landingReferrer:raw.landingReferrer ?? raw.referrer ?? '', utmSource:raw.utmSource,utmMedium:raw.utmMedium,utmCampaign:raw.utmCampaign};
    // Use server receipt time: browser clocks must not invent future activity.
    payload.occurredAt=new Date().toISOString();
    payload.sessionId=await networkSession(siteId,ip,ua);
    delete payload.visitorId;
    const headers=new Headers({'content-type':'application/json','x-minilytics-user-agent':ua});
    const country=request.headers.get('x-minilytics-country');if(country)headers.set('x-minilytics-country',country);
    const result=await ingestEvent(new Request(request.url,{method:'POST',headers,body:JSON.stringify(payload)}), siteId);
    return empty(result.status);
  } catch { return empty(503); }
}
