import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "GesLogement - Gestion de residence",
  description: "Gestion de logements, occupants, reservations et paiements.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen antialiased text-slate-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
