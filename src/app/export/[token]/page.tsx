import type { Metadata } from "next";
import { ExportDownloadForm } from "@/features/data-export/export-download-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Récupérer vos données", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** DATA-02 — page de remise de l'export. Rien n'est lu avant le code : la page ne dit pas si le lien existe. */
export default async function ExportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main id="main-content" className="mx-auto max-w-xl space-y-6 px-4 py-10 sm:py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Récupérer vos données TutelLiv</h1>
        <p className="text-sm text-muted-foreground">
          Saisissez le code reçu par SMS ou par téléphone. Le lien reste valable 7 jours.
        </p>
      </div>
      <ExportDownloadForm token={token} />
    </main>
  );
}
