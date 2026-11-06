import { createHash } from "node:crypto";
import { prisma } from "@/services/prisma/client";
import type { SystemRole } from "@prisma/client";
import type { UserWithRole } from "@/types";
import {
  DEMO_FIXTURE_CLIENTS,
  DEMO_FIXTURE_DRIVERS,
  DEMO_LOGIN_EMAIL,
  demoFixtureAuthId,
  demoPersonaAuthId,
  type DemoPersona,
  systemRoleForDemoPersona,
} from "@/lib/demo/constants";

const userInclude = {
  role: {
    include: {
      permissions: {
        include: { permission: true },
      },
    },
  },
  company: true,
} as const;

function toUserWithRole(
  user: NonNullable<
    Awaited<
      ReturnType<
        typeof prisma.user.findFirst<{
          include: typeof userInclude;
        }>
      >
    >
  >
): UserWithRole {
  return {
    ...user,
    role: {
      ...user.role,
      permissions: user.role.permissions.map((rp) => rp.permission),
    },
  } as UserWithRole;
}

export async function getUserWithRoleById(userId: string): Promise<UserWithRole | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  return user ? toUserWithRole(user) : null;
}

export async function getDemoCompany() {
  return prisma.company.findFirst({
    where: { isDemo: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getDemoPersonaUser(
  companyId: string,
  persona: DemoPersona
): Promise<UserWithRole | null> {
  if (persona === "admin") {
    const admin = await prisma.user.findFirst({
      where: {
        companyId,
        role: { systemRole: "COMPANY_ADMIN" },
        OR: [
          { email: DEMO_LOGIN_EMAIL },
          { authId: demoFixtureAuthId("admin", companyId) },
        ],
      },
      include: userInclude,
    });
    return admin ? toUserWithRole(admin) : null;
  }

  const authId = demoPersonaAuthId(persona, companyId);
  const user = await prisma.user.findFirst({
    where: { companyId, authId },
    include: userInclude,
  });
  return user ? toUserWithRole(user) : null;
}

export async function getDemoPersonaUsers(companyId: string) {
  const [admin, client, driver] = await Promise.all([
    getDemoPersonaUser(companyId, "admin"),
    getDemoPersonaUser(companyId, "client"),
    getDemoPersonaUser(companyId, "driver"),
  ]);

  return { admin, client, driver };
}

export function personaAuthIdForRole(
  companyId: string,
  systemRole: SystemRole
): string | null {
  if (systemRole === "CLIENT") return demoPersonaAuthId("client", companyId);
  if (systemRole === "DRIVER") return demoPersonaAuthId("driver", companyId);
  return null;
}

export function demoKeepEmails(): string[] {
  return [
    DEMO_LOGIN_EMAIL,
    ...DEMO_FIXTURE_CLIENTS.map((client) => client.email),
    ...DEMO_FIXTURE_DRIVERS.map((driver) => driver.email),
  ].map((email) => email.toLowerCase());
}

export function demoRosterAuthIds(companyId: string): string[] {
  return [
    demoFixtureAuthId("admin", companyId),
    ...DEMO_FIXTURE_CLIENTS.map((_, index) =>
      demoFixtureAuthId(index === 0 ? "client" : `client-${index + 1}`, companyId)
    ),
    ...DEMO_FIXTURE_DRIVERS.map((_, index) =>
      demoFixtureAuthId(index === 0 ? "driver" : `driver-${index + 1}`, companyId)
    ),
  ];
}

function emailSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type DemoSessionEmailSeed = { email: string; firstName: string; lastName: string };

/**
 * Adresse lisible d'un compte d'un espace de démonstration : `prenom.nom.xxxxxx@domaine`.
 * Le suffixe court (6 caractères tirés de l'identifiant de l'espace) garde l'adresse unique d'un espace à l'autre.
 */
export function demoSessionEmail(seed: DemoSessionEmailSeed, companyId: string): string {
  const domain = seed.email.toLowerCase().split("@")[1] || "tutelliv.fr";
  const tag = createHash("sha256").update(companyId).digest("hex").slice(0, 6);
  const name = [emailSlug(seed.firstName), emailSlug(seed.lastName)].filter(Boolean).join(".");
  return `${name || "compte"}.${tag}@${domain}`;
}

/** Ancien format (avant le 6 novembre 2026), encore présent dans les espaces préparés avant. */
export function legacyDemoSessionEmail(seedEmail: string, companyId: string): string {
  const [localPart, domain = "tutelliv.fr"] = seedEmail.toLowerCase().split("@");
  return `${localPart}+session-${companyId}@${domain}`;
}

export function isDemoSessionRosterEmail(email: string, seed: DemoSessionEmailSeed, companyId: string): boolean {
  return email === demoSessionEmail(seed, companyId) || email === legacyDemoSessionEmail(seed.email, companyId);
}

export function demoPersonaSeedUsers(companyId: string) {
  return [
    {
      persona: "admin" as const,
      email: DEMO_LOGIN_EMAIL,
      firstName: "Alex",
      lastName: "Démo",
      roleSlug: "company-admin" as const,
      authId: null as string | null,
      phone: "0600000001",
    },
    ...DEMO_FIXTURE_CLIENTS.map((client, index) => ({
      persona: index === 0 ? ("client" as const) : null,
      email: client.email,
      firstName: client.firstName,
      lastName: client.lastName,
      roleSlug: "client" as const,
      authId: demoFixtureAuthId(index === 0 ? "client" : `client-${index + 1}`, companyId),
      // Numéros de la plage réservée à la fiction (06 39 98) : le livreur peut « appeler le client » en démo.
      phone: `063998001${index}` as string | null,
    })),
    ...DEMO_FIXTURE_DRIVERS.map((driver, index) => ({
      persona: index === 0 ? ("driver" as const) : null,
      email: driver.email,
      firstName: driver.firstName,
      lastName: driver.lastName,
      roleSlug: "driver" as const,
      authId: demoFixtureAuthId(index === 0 ? "driver" : `driver-${index + 1}`, companyId),
      phone: `060000000${index + 2}`,
    })),
  ];
}

export async function ensureDemoRosterUsers(companyId: string, adminAuthId?: string) {
  const seedUsers = demoPersonaSeedUsers(companyId);
  const roleSlugs = [...new Set(seedUsers.map((user) => user.roleSlug))];
  const roles = await prisma.role.findMany({
    where: { slug: { in: roleSlugs } },
  });
  const roleBySlug = new Map(roles.map((role) => [role.slug, role]));

  for (const seed of seedUsers) {
    const role = roleBySlug.get(seed.roleSlug);
    if (!role) throw new Error(`Rôle ${seed.roleSlug} introuvable — lancez npm run db:seed`);

    const resolvedAuthId =
      seed.persona === "admin" ? (adminAuthId ?? seed.authId) : seed.authId;
    if (!resolvedAuthId) continue;

    await prisma.user.upsert({
      where: { email: seed.email },
      update: {
        authId: resolvedAuthId,
        firstName: seed.firstName,
        lastName: seed.lastName,
        phone: seed.phone,
        roleId: role.id,
        companyId,
        status: "ACTIVE",
      },
      create: {
        authId: resolvedAuthId,
        email: seed.email,
        firstName: seed.firstName,
        lastName: seed.lastName,
        phone: seed.phone,
        roleId: role.id,
        companyId,
        status: "ACTIVE",
      },
    });
  }
}

/** Roster sans compte Supabase, propre à une session de démonstration isolée. */
export async function ensureDemoSessionRosterUsers(companyId: string) {
  const seedUsers = demoPersonaSeedUsers(companyId).map((seed) => ({
    ...seed,
    email: demoSessionEmail(seed, companyId),
    authId:
      seed.persona === "admin"
        ? demoFixtureAuthId("admin", companyId)
        : seed.authId,
  }));
  const roleSlugs = [...new Set(seedUsers.map((user) => user.roleSlug))];
  const roles = await prisma.role.findMany({ where: { slug: { in: roleSlugs } } });
  const roleBySlug = new Map(roles.map((role) => [role.slug, role]));

  await Promise.all(seedUsers.map(async (seed) => {
    const role = roleBySlug.get(seed.roleSlug);
    if (!role) throw new Error(`Rôle ${seed.roleSlug} introuvable — lancez npm run db:seed`);
    if (!seed.authId) throw new Error("DEMO_SESSION_AUTH_ID_MISSING");
    await prisma.user.upsert({
      where: { authId: seed.authId },
      update: {
        email: seed.email,
        firstName: seed.firstName,
        lastName: seed.lastName,
        phone: seed.phone,
        roleId: role.id,
        companyId,
        status: "ACTIVE",
      },
      create: {
        authId: seed.authId,
        email: seed.email,
        firstName: seed.firstName,
        lastName: seed.lastName,
        phone: seed.phone,
        roleId: role.id,
        companyId,
        status: "ACTIVE",
      },
    });
  }));
}

export function roleSlugForPersona(persona: DemoPersona): string {
  const map: Record<DemoPersona, string> = {
    admin: "company-admin",
    client: "client",
    driver: "driver",
  };
  return map[persona];
}

export function systemRoleForPersona(persona: DemoPersona): SystemRole {
  return systemRoleForDemoPersona(persona);
}
