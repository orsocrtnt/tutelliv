import { NextResponse } from "next/server";
import { createClient } from "@/services/supabase/server";
import { completeGoogleLogin } from "@/domains/auth/google-login.service";
import { clearDemoPersonaCookie, clearDemoSessionCookie } from "@/lib/demo/persona-cookie";
import {
  GOOGLE_LOGIN_PARAM,
  googleLoginReturnPath,
  type GoogleLoginRefusal,
} from "@/lib/auth/google-login";

export const dynamic = "force-dynamic";

function isDatabaseUnavailable(error: unknown): boolean {
  const candidate = error as { name?: string; code?: string } | null;
  if (!candidate) return false;
  if (candidate.name === "PrismaClientInitializationError") return true;
  return candidate.code === "P1001" || candidate.code === "P1002" || candidate.code === "P2024";
}

/**
 * Retour de Google (AUTH-GOOGLE). Le code est échangé côté serveur (PKCE : le vérificateur est dans un
 * cookie du navigateur qui a cliqué). La destination est toujours choisie par le serveur d'après le rôle
 * relu en base : aucun paramètre de redirection n'est suivi.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const loginPath = googleLoginReturnPath(url.searchParams.get("from"));
  const refuse = (reason: GoogleLoginRefusal) => {
    const target = new URL(loginPath, url.origin);
    target.searchParams.set(GOOGLE_LOGIN_PARAM, reason);
    return NextResponse.redirect(target, { status: 303 });
  };

  const code = url.searchParams.get("code");
  // Annulation sur l'écran Google, ou erreur du fournisseur : rien n'a été ouvert.
  if (!code) return refuse("error");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    const status = (error as { status?: number } | null)?.status;
    return refuse(status === 0 || (typeof status === "number" && status >= 500) ? "service" : "error");
  }

  let outcome: Awaited<ReturnType<typeof completeGoogleLogin>>;
  try {
    outcome = await completeGoogleLogin(data.user);
  } catch (caught) {
    console.error("Google login error:", caught instanceof Error ? caught.name : "unknown");
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return refuse(isDatabaseUnavailable(caught) ? "service" : "error");
  }

  if (outcome.kind === "refused") {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return refuse(outcome.reason);
  }

  // Un ancien essai de la démo dans ce navigateur ne doit pas teinter la session du vrai compte.
  await Promise.allSettled([clearDemoPersonaCookie(), clearDemoSessionCookie()]);
  return NextResponse.redirect(new URL(outcome.redirectTo, url.origin), { status: 303 });
}
