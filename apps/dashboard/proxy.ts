import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
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
  matcher: ["/((?!api/collect|_next/static|_next/image|favicon.ico).*)"],
};
