import { NextResponse } from "next/server";
import { touchDemoPoolLease } from "@/domains/demo/demo-pool.service";
import { getDemoSessionCompanyIdOrNull } from "@/domains/demo/demo-session.service";
import { getDemoSessionCookie } from "@/lib/demo/persona-cookie";
import { DEMO_EXPIRED_PATH } from "@/lib/demo/constants";

function expired() {
  return NextResponse.json({ expired: true, redirectTo: DEMO_EXPIRED_PATH }, { status: 410 });
}

/**
 * Signe de vie d'une démo ouverte (onglet visible) : compteur « en direct » du super admin.
 * 410 quand l'espace prêté n'existe plus (bail expiré ou repris après 30 min sans signe de vie) :
 * l'onglet rouvert part vers /demonstration au lieu d'afficher un espace qui n'est plus le sien.
 */
export async function POST() {
  const sessionId = await getDemoSessionCookie();
  if (!sessionId) return expired();
  try {
    if (await touchDemoPoolLease(sessionId)) return new NextResponse(null, { status: 204 });
    // Anciennes sessions DEMO-1 hors pool : encore valides jusqu'à leur expiration.
    if (await getDemoSessionCompanyIdOrNull()) return new NextResponse(null, { status: 204 });
    return expired();
  } catch (error) {
    // Base indisponible : ne jamais renvoyer un visiteur pour une panne passagère.
    console.error("Demo heartbeat failed:", error);
    return new NextResponse(null, { status: 204 });
  }
}
