/** DATA-02 — ouverture de l'export d'une entreprise : lien + code donné à part (voir company-export-delivery.service). */
import { NextResponse } from "next/server";
import { openCompanyExport } from "@/domains/data-lifecycle/company-export-delivery.service";
import { contactSourceFromHeaders } from "@/domains/growth/contact.service";
import { isOverRequestLimit } from "@/lib/security/request-limit";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // En plus des 5 codes faux par lien : 20 essais par adresse et par quart d'heure, tous liens confondus.
  if (await isOverRequestLimit("data-export-code", contactSourceFromHeaders(request.headers), 20)) {
    return NextResponse.json({ error: "Trop d'essais. Réessayez dans un quart d'heure." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "900" } });
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  try {
    const result = await openCompanyExport(token, body?.code);
    switch (result.status) {
      case "ok":
        return NextResponse.json(result, { headers: NO_STORE });
      case "wrong":
        return NextResponse.json(
          { error: `Code incorrect. ${result.remaining} essai${result.remaining > 1 ? "s" : ""} restant${result.remaining > 1 ? "s" : ""}.` },
          { status: 400, headers: NO_STORE }
        );
      case "locked":
        return NextResponse.json({ error: "Trop de codes faux : ce lien est bloqué. Demandez un nouveau lien à TutelLiv." }, { status: 423, headers: NO_STORE });
      default:
        return NextResponse.json({ error: "Ce lien n'est plus valide (expiré ou retiré). Demandez un nouveau lien à TutelLiv." }, { status: 410, headers: NO_STORE });
    }
  } catch (error) {
    console.error("[data-export.open]", error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "FAILED");
    return NextResponse.json({ error: "Service momentanément indisponible. Réessayez dans quelques minutes." }, { status: 503, headers: NO_STORE });
  }
}
