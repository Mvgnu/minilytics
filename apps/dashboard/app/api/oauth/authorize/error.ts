export function oauthAuthorizationError(message: string) {
  return new Response(message, {
    status: 400,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
