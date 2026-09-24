import type { Metadata } from "next";
import "./globals.css";

// Force per-request rendering for all pages. Prerendered static shells get
// `Cache-Control: s-maxage=31536000` from Next, so a broken deploy keeps
// rendering stale cached HTML (with 404ing chunk refs) even after the server
// is fixed. Dynamic rendering sends `private, no-cache, no-store` for the
// shell; /_next/static chunks keep their immutable caching. Must live in a
// SERVER component — segment config exports are ignored in "use client" files.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mission Control",
  description: "Your daily command center.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
