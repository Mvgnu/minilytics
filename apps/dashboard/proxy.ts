import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set([
  "/api/collect",
  "/api/mcp",
  "/api/oauth/register",
  "/api/oauth/token",
  "/api/oauth/revoke",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
]);

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/.well-known/")) {
    return NextResponse.next();
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const authorization = request.headers.get("authorization");
  const expected = `Basic ${btoa(`admin:${password}`)}`;

  if (authorization === expected) return NextResponse.next();

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="Minilytics"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
