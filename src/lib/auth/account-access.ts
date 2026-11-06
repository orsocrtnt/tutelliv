import type { UserWithRole } from "@/types";

/** À évaluer sur les données fraîches du serveur, jamais sur un état client. */
export function isAccountActive(user: UserWithRole): boolean {
  if (user.status !== "ACTIVE") return false;
  if (!user.companyId) return user.role.systemRole === "SUPER_ADMIN";
  return user.company?.id === user.companyId &&
    (user.company.status === "ACTIVE" || user.company.status === "TRIAL");
}

export class AccountUnavailableError extends Error {
  constructor() {
    super("ACCOUNT_UNAVAILABLE");
    this.name = "AccountUnavailableError";
  }
}

/**
 * Compte de démo dont l'espace prêté n'existe plus (bail expiré, repris après 30 min sans signe de vie,
 * ou cookie de session disparu). Hérite d'AccountUnavailableError : tout appelant existant refuse l'accès.
 */
export class DemoSessionExpiredError extends AccountUnavailableError {
  constructor() {
    super();
    this.name = "DemoSessionExpiredError";
  }
}

export function assertAccountActive(user: UserWithRole): void {
  if (!isAccountActive(user)) throw new AccountUnavailableError();
}
