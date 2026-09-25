import { getRealtime } from "../../../../../lib/realtime";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{siteId: string}> }) {
  const { siteId } = await params;
  try {
    const data = await getRealtime(siteId);
    return Response.json(data ?? {error: "Unknown site"}, {
      status: data ? 200 : 404, headers: {"cache-control": "private, no-store"},
    });
  } catch {
    return Response.json({error: "Realtime is temporarily unavailable"}, {status: 503});
  }
}
