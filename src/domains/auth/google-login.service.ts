import { AccountUnavailableError } from "@/lib/auth/account-access";
import { normalizeEmail } from "@/lib/auth/normalize-email";
import { isDemoLoginEmail } from "@/lib/demo/constants";
import { prisma } from "@/services/prisma/client";
import { createAdminClient } from "@/services/supabase/admin";
import { getUserByAuthId } from "@/domains/user/user.service";
import {
  getDashboardPathForRole,
  syncUserFromSupabase,
  UserNotProvisionedError,
} from "@/domains/auth/auth.service";
import { resolveOnboardingLoginPath } from "@/domains/onboarding/onboarding.service";
import type { GoogleLoginRefusal } from "@/lib/auth/google-login";

/** Compte Supabase rendu par l'échange du code Google (sous-ensemble utile de `User`). */
export interface GoogleAuthUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  created_at?: string | null;
  identities?: { provider: string }[] | null;
  user_metadata?: Record<string, unknown> | null;
}

export type GoogleLoginOutcome =
  | { kind: "signed-in"; redirectTo: string }
  | { kind: "refused"; reason: GoogleLoginRefusal };

/** Un compte Supabase vide créé par ce clic Google a moins de dix minutes. */
const ORPHAN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Compte Supabase né de ce clic Google et rattaché à aucun profil TutelLiv : il est supprimé, sinon il
 * bloquerait plus tard l'invitation (`inviteUserByEmail` : « already registered ») ou l'inscription de
 * cette adresse. Jamais supprimé : un compte qui a une autre identité (mot de passe, invitation), une
 * inscription en cours (`signup_flow`), plus de dix minutes ou un profil TutelLiv.
 */
export function isDisposableGoogleOrphan(authUser: GoogleAuthUser, now = Date.now()): boolean {
  const identities = authUser.identities ?? [];
  if (identities.length === 0 || identities.some((identity) => identity.provider !== "google")) return false;
  if (authUser.user_metadata && "signup_flow" in authUser.user_metadata) return false;
  const createdAt = authUser.created_at ? Date.parse(authUser.created_at) : Number.NaN;
  return Number.isFinite(createdAt) && now - createdAt >= 0 && now - createdAt <= ORPHAN_MAX_AGE_MS;
}

async function deleteGoogleOrphan(authUser: GoogleAuthUser): Promise<void> {
  try {
    if (!isDisposableGoogleOrphan(authUser)) return;
    if (await getUserByAuthId(authUser.id)) return;
    const { error } = await createAdminClient().auth.admin.deleteUser(authUser.id);
    if (error) console.error("Google login orphan cleanup failed:", error.status ?? error.name);
  } catch (error) {
    console.error("Google login orphan cleanup failed:", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Invitation encore ouverte : l'adresse vérifiée par Google vaut acceptation (décision du 12 novembre
 * 2026). Mêmes garde-fous que le lien d'invitation : même identifiant de connexion, statut encore
 * « en attente », entreprise active ou en essai.
 */
async function acceptPendingInvitation(authId: string): Promise<void> {
  const user = await getUserByAuthId(authId);
  if (user?.status !== "PENDING_VERIFICATION" || !user.companyId) return;
  await prisma.user.updateMany({
    where: {
      id: user.id,
      authId,
      status: "PENDING_VERIFICATION",
      companyId: user.companyId,
      company: { status: { in: ["ACTIVE", "TRIAL"] }, isDemo: false },
    },
    data: { status: "ACTIVE" },
  });
}

/**
 * Retour de Google, session Supabase déjà ouverte. Un compte Google n'ouvre jamais d'accès à lui seul :
 * il faut un profil TutelLiv rattaché à ce compte (même adresse, liaison automatique de Supabase), actif,
 * hors démo. L'appelant ferme la session pour tout refus.
 */
export async function completeGoogleLogin(authUser: GoogleAuthUser): Promise<GoogleLoginOutcome> {
  if (!authUser.email || !authUser.email_confirmed_at) return { kind: "refused", reason: "error" };
  const email = normalizeEmail(authUser.email);
  if (isDemoLoginEmail(email)) return { kind: "refused", reason: "unavailable" };

  try {
    const existing = await getUserByAuthId(authUser.id);
    if (existing?.company?.isDemo) return { kind: "refused", reason: "unavailable" };
    if (existing) await acceptPendingInvitation(authUser.id);

    const user = await syncUserFromSupabase({ authId: authUser.id, email });
    if (user.company?.isDemo) return { kind: "refused", reason: "unavailable" };
    const redirectTo = await resolveOnboardingLoginPath(
      user,
      getDashboardPathForRole(user.role.systemRole, user.settings)
    );
    return { kind: "signed-in", redirectTo };
  } catch (error) {
    if (error instanceof UserNotProvisionedError) {
      await deleteGoogleOrphan(authUser);
      return { kind: "refused", reason: "unknown" };
    }
    if (error instanceof AccountUnavailableError) {
      await deleteGoogleOrphan(authUser);
      return { kind: "refused", reason: "unavailable" };
    }
    throw error;
  }
}
