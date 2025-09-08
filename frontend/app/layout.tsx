import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata = {
  title: "TutelLiv",
  description: "Plateforme MJPM / Livreurs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 text-gray-900">
        <div className="min-h-screen flex">
          {/* Sidebar (desktop) */}
          <Sidebar />
          {/* Main */}
          <main className="flex-1 p-6">
            <div className="max-w-5xl mx-auto space-y-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
