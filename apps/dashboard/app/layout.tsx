import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minilytics",
  description: "Tiny first-party analytics for your projects",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">
            <span className="brandMark">M</span>
            <span>Minilytics</span>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Link className="muted" href="/mcp">Connect MCP</Link>
            <span className="muted">First-party · Multi-site</span>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
