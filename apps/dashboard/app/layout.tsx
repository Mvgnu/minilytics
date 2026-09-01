import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minilytics",
  description: "Small first-party analytics for your own sites.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brandMark">m</span>
            minilytics
          </Link>
          <span className="muted">first-party analytics</span>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
