import type { Metadata, Viewport } from "next";
import { fontVariables } from "../fonts";
import "../globals.css";

// A root layout of its own, without ClerkProvider: opened with no signal, Clerk's script fails and Safari then failed
// to load it on the next page too (WebKit, 2026-11-24: 2 of 8 loads worked, 8 of 8 without it).
export const metadata: Metadata = {
  title: "Cooking with your Mom",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Mama", statusBarStyle: "default" },
  robots: { index: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#c93a24",
};

export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="ambient" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
