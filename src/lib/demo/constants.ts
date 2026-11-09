import type { SystemRole } from "@prisma/client";

/** Identifiants de connexion démo — modifiables après le premier seed. */
export const DEMO_LOGIN_EMAIL = "demo@tutelliv.fr";
export const DEMO_DEFAULT_PASSWORD = "Demo2026!";

export const DEMO_CLIENT_EMAIL = "demo-client@tutelliv.fr";
export const DEMO_DRIVER_EMAIL = "demo-driver@tutelliv.fr";
export const DEMO_COMPANY_SLUG = "logiexpress-demo";
export const DEMO_COMPANY_NAME = "LogiExpress Démo";

/**
 * Comptes figés de la démo — restent après reset, non supprimables.
 * `email` identifie le compte de l'espace de base (ne pas changer) ; `sessionEmail` est l'adresse lisible
 * des espaces prêtés aux visiteurs, sur un domaine `.demo` qui ne reçoit jamais de courrier.
 * Les clients sont des entreprises : le nom s'affiche « prénom nom », d'où le découpage.
 */
export const DEMO_FIXTURE_CLIENTS = [
  { email: DEMO_CLIENT_EMAIL, firstName: "Pharmacie", lastName: "du Marais", sessionEmail: "contact@pharmacie-du-marais.demo" },
  { email: "demo-client-2@tutelliv.fr", firstName: "Cabinet", lastName: "Lefèvre Avocats", sessionEmail: "accueil@lefevre-avocats.demo" },
  { email: "demo-client-3@tutelliv.fr", firstName: "Fleurs", lastName: "de Belleville", sessionEmail: "bonjour@fleurs-de-belleville.demo" },
  { email: "demo-client-4@tutelliv.fr", firstName: "Agence", lastName: "Bastille Immobilier", sessionEmail: "contact@bastille-immobilier.demo" },
  { email: "demo-client-5@tutelliv.fr", firstName: "Atelier", lastName: "Nation", sessionEmail: "atelier@atelier-nation.demo" },
] as const;

export const DEMO_FIXTURE_DRIVERS = [
  { email: DEMO_DRIVER_EMAIL, firstName: "Marc", lastName: "Lefort", sessionEmail: "marc.lefort@logiexpress.demo" },
  { email: "demo-driver-2@tutelliv.fr", firstName: "Jean", lastName: "Dupont", sessionEmail: "jean.dupont@logiexpress.demo" },
  { email: "demo-driver-3@tutelliv.fr", firstName: "Karim", lastName: "Benali", sessionEmail: "karim.benali@logiexpress.demo" },
  { email: "demo-driver-4@tutelliv.fr", firstName: "Sophie", lastName: "Laurent", sessionEmail: "sophie.laurent@logiexpress.demo" },
  { email: "demo-driver-5@tutelliv.fr", firstName: "Lucas", lastName: "Garnier", sessionEmail: "lucas.garnier@logiexpress.demo" },
] as const;

export function isDemoLockedAccountEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (normalized === DEMO_LOGIN_EMAIL) return true;
  return (
    DEMO_FIXTURE_CLIENTS.some((client) => client.email === normalized) ||
    DEMO_FIXTURE_DRIVERS.some((driver) => driver.email === normalized)
  );
}

export const DEMO_PERSONA_COOKIE = "tutelliv-demo-persona";
export const DEMO_SESSION_COOKIE = "tutelliv-demo-session";

/** Où renvoyer un visiteur dont la démo a expiré : le lanceur l'explique et ouvre une démo neuve. */
export const DEMO_EXPIRED_PATH = "/demo?session=expiree";
export const DEMO_SESSION_COMPANY_PREFIX = `${DEMO_COMPANY_SLUG}-session-`;
export const DEMO_POOL_COMPANY_PREFIX = `${DEMO_COMPANY_SLUG}-pool-`;
export const DEMO_POOL_KEY = "public";
export const DEMO_POOL_MIN_READY = 3;

/**
 * Version du scénario de démo. À changer à chaque modification du scénario : les espaces
 * du pool préparés avec une autre version sont recyclés par la maintenance du pool.
 */
export const DEMO_SCENARIO_VERSION = "2026-11-09-numeros";

export function isDemoScenarioOutdated(settings: unknown): boolean {
  const marker = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).demoScenarioVersion
    : undefined;
  return marker !== DEMO_SCENARIO_VERSION;
}

export type DemoPersona = "admin" | "client" | "driver";

export const DEMO_PERSONA_LABELS: Record<DemoPersona, string> = {
  admin: "Administrateur",
  client: "Client",
  driver: "Livreur",
};

export const DEMO_PERSONA_PATHS: Record<DemoPersona, string> = {
  admin: "/dashboard",
  client: "/portal",
  driver: "/driver",
};

const PERSONA_ROLE_MAP: Record<DemoPersona, SystemRole> = {
  admin: "COMPANY_ADMIN",
  client: "CLIENT",
  driver: "DRIVER",
};

const ROLE_PERSONA_MAP: Partial<Record<SystemRole, DemoPersona>> = {
  COMPANY_ADMIN: "admin",
  MINI_ADMIN: "admin",
  DISPATCHER: "admin",
  CLIENT: "client",
  DRIVER: "driver",
};

export function demoPersonaForRole(systemRole: SystemRole): DemoPersona {
  return ROLE_PERSONA_MAP[systemRole] ?? "admin";
}

export function systemRoleForDemoPersona(persona: DemoPersona): SystemRole {
  return PERSONA_ROLE_MAP[persona];
}

export function isDemoLoginEmail(email: string): boolean {
  return email.trim().toLowerCase() === DEMO_LOGIN_EMAIL;
}

export function demoPersonaAuthId(persona: "client" | "driver", companyId: string): string {
  return `demo-persona-${persona}-${companyId}`;
}

export function demoFixtureAuthId(key: string, companyId: string): string {
  return `demo-persona-${key}-${companyId}`;
}
