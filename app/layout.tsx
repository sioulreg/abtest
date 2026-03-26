import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A/B Test Analyzer",
  description: "Analyse statistique de tests A/B avec insights business IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
