import {
  issueAuthorizationCode,
  mcpResourceUrl,
  oauthErrorResponse,
  signAuthorizationRequest,
  validateAuthorizationRequest,
  verifyAuthorizationRequest,
} from "../../../../lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function GET(request: Request) {
  try {
    const authorization = await validateAuthorizationRequest(
      new URL(request.url).searchParams,
      request,
    );
    const signed = signAuthorizationRequest(authorization);
    return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize Minilytics</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#0b0d10;color:#f4f6f8}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,rgba(216,255,99,.1),transparent 32rem),#0b0d10}
    main{width:min(520px,100%);padding:28px;border:1px solid #262c35;border-radius:18px;background:linear-gradient(180deg,#171b21,#12151a);box-shadow:0 30px 100px rgba(0,0,0,.35)}
    .mark{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:#d8ff63;color:#111408;font-weight:900}h1{margin:22px 0 8px;font-size:30px;letter-spacing:-.04em}p{color:#8e98a6;line-height:1.55}.client{margin:22px 0;padding:16px;border:1px solid #262c35;border-radius:13px;background:rgba(0,0,0,.15)}.client strong{display:block;margin-bottom:5px}.scope{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#d8ff63;font-size:12px}
    form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:22px}button{min-height:46px;border:1px solid #303843;border-radius:11px;background:#171b21;color:#f4f6f8;font-weight:750;cursor:pointer}button[value=approve]{border-color:#d8ff63;background:#d8ff63;color:#111408}small{display:block;margin-top:18px;color:#697483;line-height:1.45}
  </style>
</head>
<body>
  <main>
    <div class="mark">M</div>
    <h1>Connect analytics</h1>
    <p>This grants a read-only MCP client access to the analytics already stored in this Minilytics dashboard.</p>
    <div class="client">
      <strong>${escapeHtml(authorization.clientName)}</strong>
      <span class="scope">analytics:read</span>
    </div>
    <p>The client can list projects and read overview, traffic, acquisition, content and journey reports. It cannot change sites, goals, funnels or stored events.</p>
    <form method="post" action="/api/oauth/authorize">
      <input type="hidden" name="request" value="${escapeHtml(signed)}">
      <button type="submit" name="decision" value="deny">Cancel</button>
      <button type="submit" name="decision" value="approve">Authorize</button>
    </form>
    <small>Protected resource: ${escapeHtml(authorization.resource)}</small>
  </main>
</body>
</html>`);
  } catch (error) {
    const response = oauthErrorResponse(error);
    return html(
      `<!doctype html><html><body><h1>Authorization failed</h1><p>${escapeHtml(await response.text())}</p></body></html>`,
      response.status,
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const raw = form.get("request");
    const decision = form.get("decision");
    if (typeof raw !== "string") throw new Error("Missing authorization request.");
    const authorization = verifyAuthorizationRequest(raw);
    if (authorization.resource !== mcpResourceUrl(request)) {
      throw new Error("Protected resource changed during authorization.");
    }

    const redirect = new URL(authorization.redirectUri);
    if (decision !== "approve") {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "The owner denied access.");
    } else {
      const code = await issueAuthorizationCode(authorization);
      redirect.searchParams.set("code", code);
    }
    if (authorization.state) redirect.searchParams.set("state", authorization.state);
    return Response.redirect(redirect, 302);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
