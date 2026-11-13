/** Retour de Google : refus affiché sur `/login?google=<raison>` (aucune donnée personnelle dans l'adresse). */
export const GOOGLE_LOGIN_PARAM = "google";
export const GOOGLE_CALLBACK_PATH = "/auth/callback";
/** Jeton Google (bouton officiel) échangé côté serveur : la fenêtre Google affiche « tutelliv.fr ». */
export const GOOGLE_ID_TOKEN_PATH = "/api/auth/google";

/**
 * Identifiant public du client OAuth « Application Web » (projet Google Cloud « TutelLiv »), déclaré aussi
 * dans Supabase (fournisseur Google, « Client IDs »). Public par nature : il figure dans chaque page Google.
 * Une autre base (future production) peut en fournir un autre par `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
 */
export const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "478277728600-8dkgje98373234lrc3ksfi3mdpbmjhb4.apps.googleusercontent.com";

export type GoogleLoginRefusal = "unknown" | "unavailable" | "error" | "service";

export const GOOGLE_LOGIN_MESSAGES: Record<GoogleLoginRefusal, string> = {
  unknown:
    "Aucun compte TutelLiv pour cette adresse Google. Si vous travaillez avec une entreprise de livraison, demandez-lui une invitation.",
  unavailable: "Compte ou entreprise indisponible. Contactez votre administrateur.",
  error: "La connexion avec Google n’a pas abouti. Réessayez, ou utilisez votre e-mail et votre mot de passe.",
  service: "Service de connexion momentanément indisponible. Réessayez dans quelques instants.",
};

export function isGoogleLoginRefusal(value: unknown): value is GoogleLoginRefusal {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(GOOGLE_LOGIN_MESSAGES, value);
}

/** Refus lu dans l'adresse de la page de connexion ; toute autre valeur est ignorée. */
export function googleRefusalFrom(params: Record<string, string | string[] | undefined>): GoogleLoginRefusal | null {
  const raw = params[GOOGLE_LOGIN_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isGoogleLoginRefusal(value) ? value : null;
}

/** Page de connexion d'où partait le clic : le refus y revient (espace client ou livreur compris). */
export function googleLoginReturnPath(from: string | null | undefined): string {
  return from === "/login/client" || from === "/login/driver" ? from : "/login";
}
