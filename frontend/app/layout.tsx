// frontend/app/layout.tsx
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TutelLiv",
  description: "Plateforme MJPM / Livreurs",
};

// ❌ Pas d'import Viewport (certaines versions de Next ne l'exportent pas)
// ✅ On laisse Next inférer le type de l'objet 'viewport'
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 text-gray-900">
        {/* Header (masqué automatiquement sur /login dans le composant) */}
        <Header />
        <div className="min-h-[calc(100vh-56px)] md:min-h-[calc(100vh-64px)] md:flex">
          <Sidebar />
          <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6">
            <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
