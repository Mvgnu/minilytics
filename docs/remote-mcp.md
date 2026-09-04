# Remote Minilytics MCP

Deploy the dashboard over HTTPS, set `MINILYTICS_PUBLIC_URL` to its canonical origin, set a strong `MINILYTICS_OAUTH_SECRET`, and run `npm run db:migrate`.

The remote MCP URL is:

```text
https://your-analytics-host.example/api/mcp
```

OAuth discovery, dynamic client registration, S256 PKCE, refresh rotation and token revocation are handled by the dashboard. The owner approval page is protected by the dashboard Basic-auth password. The only OAuth scope is `analytics:read`.
