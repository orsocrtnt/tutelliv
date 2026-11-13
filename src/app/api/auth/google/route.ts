import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/services/supabase/server";
import { completeGoogleLogin } from "@/domains/auth/google-login.service";
import { clearDemoPersonaCookie, clearDemoSessionCookie } from "@/lib/demo/persona-cookie";
import { GOOGLE_LOGIN_MESSAGES, type GoogleLoginRefusal } from "@/lib/auth/google-login";

const bodySchema = z.object({
  credential: z.string().min(20).max(8_000),
  nonce: z.string().min(16).max(200),
});

function isDatabaseUnavailable(error: unknown): boolean {
  const candidate = error as { name?: string; code?: string } | null;
  if (!candidate) return false;
  if (candidate.name === "PrismaClientInitializationError") return true;
  return candidate.code === "P1001" || candidate.code === "P1002" || candidate.code === "P2024";
}

function refuse(reason: GoogleLoginRefusal) {
  const status = reason === "service" ? 503 : reason === "error" ? 400 : 403;
  return NextResponse.json({ error: GOOGLE_LOGIN_MESSAGES[reason], reason }, { status });
}

/**
 * Bouton officiel Google (AUTH-GOOGLE) : le navigateur reçoit un jeton d'identité signé par Google et
 * l'envoie ici avec le nonce brut. Supabase vérifie la signature, l'audience (identifiant client déclaré)
 * et le nonce, puis ouvre la session ; la décision d'accès reste celle de `completeGoogleLogin`.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("error");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: parsed.data.credential,
    nonce: parsed.data.nonce,
  });
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

  await Promise.allSettled([clearDemoPersonaCookie(), clearDemoSessionCookie()]);
  return NextResponse.json({ redirectTo: outcome.redirectTo });
}
