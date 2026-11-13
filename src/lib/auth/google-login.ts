/** Retour de Google : refus affiché sur `/login?google=<raison>` (aucune donnée personnelle dans l'adresse). */
export const GOOGLE_LOGIN_PARAM = "google";
export const GOOGLE_CALLBACK_PATH = "/auth/callback";

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
