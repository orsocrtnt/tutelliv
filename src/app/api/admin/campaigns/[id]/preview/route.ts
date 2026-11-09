import { NextResponse } from "next/server";
import { requireRole, requireStaffRole } from "@/lib/api/auth-guard";
import { gatePlatformRead } from "@/lib/api/platform-access";
import { previewProspectEmail, prospectLinkBaseUrl } from "@/domains/growth/prospect/prospect-campaign.service";

const noStore = { "Cache-Control": "no-store" };

/** Aperçu du mail de la campagne, affiché dans la page Campagnes avant l'envoi (liens au code « test »). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffRole("dashboard:admin");
  if ("error" in auth) return auth.error;
  const denied = requireRole(auth.context, ["SUPER_ADMIN"]);
  const blocked = await gatePlatformRead(auth.context, denied, "PROSPECT_CAMPAIGNS");
  if (blocked) return blocked;

  const { id } = await context.params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Campagne introuvable" }, { status: 404, headers: noStore });
  const data = await previewProspectEmail(id, prospectLinkBaseUrl(request.url));
  if (!data) return NextResponse.json({ error: "Campagne introuvable" }, { status: 404, headers: noStore });
  return NextResponse.json({ data, success: true }, { headers: noStore });
}
