import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";
import * as zod from "zod";
import {
  GOOGLE_LOGIN_MESSAGES,
  googleLoginReturnPath,
  googleRefusalFrom,
} from "../src/lib/auth/google-login";

class AccountUnavailableError extends Error {}
class UserNotProvisionedError extends Error {}

type Fixture = {
  byAuthId?: Record<string, unknown> | null;
  sync?: () => Promise<unknown>;
};

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function loadModule<T>(file: string, dependencies: Record<string, unknown>): T {
  const module = { exports: {} as T };
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports: module.exports,
    module,
    console: { error() {} },
    URL,
    Date,
    Number,
    Object,
    Promise,
    require: (id: string) => {
      if (!(id in dependencies)) throw new Error(`dépendance non prévue : ${id}`);
      return dependencies[id];
    },
  });
  return module.exports;
}

function loadService(fixture: Fixture) {
  const calls = { updateMany: [] as unknown[], deleted: [] as string[], synced: 0 };
  const service = loadModule<{
    completeGoogleLogin: (user: unknown) => Promise<{ kind: string; reason?: string; redirectTo?: string }>;
    isDisposableGoogleOrphan: (user: unknown, now?: number) => boolean;
  }>("src/domains/auth/google-login.service.ts", {
    "@/lib/auth/account-access": { AccountUnavailableError },
    "@/lib/auth/normalize-email": { normalizeEmail: (value: string) => value.trim().toLowerCase() },
    "@/lib/demo/constants": { isDemoLoginEmail: (email: string) => email === "demo@fixture.invalid" },
    "@/services/prisma/client": {
      prisma: { user: { updateMany: async (args: unknown) => { calls.updateMany.push(plain(args)); return { count: 1 }; } } },
    },
    "@/services/supabase/admin": {
      createAdminClient: () => ({ auth: { admin: { deleteUser: async (id: string) => { calls.deleted.push(id); return { error: null }; } } } }),
    },
    "@/domains/user/user.service": { getUserByAuthId: async () => fixture.byAuthId ?? null },
    "@/domains/auth/auth.service": {
      UserNotProvisionedError,
      getDashboardPathForRole: (role: string) => (role === "DRIVER" ? "/driver" : "/dashboard"),
      syncUserFromSupabase: async () => {
        calls.synced += 1;
        if (fixture.sync) return fixture.sync();
        return fixture.byAuthId;
      },
    },
    "@/domains/onboarding/onboarding.service": { resolveOnboardingLoginPath: async (_user: unknown, path: string) => path },
  });
  return {
    completeGoogleLogin: async (user: unknown) => plain(await service.completeGoogleLogin(user)),
    isDisposableGoogleOrphan: service.isDisposableGoogleOrphan,
    calls,
  };
}

const NOW = Date.parse("2026-11-12T15:00:00Z");
const googleUser = (overrides: Record<string, unknown> = {}) => ({
  id: "auth-google",
  email: "Invite@Fixture.invalid",
  email_confirmed_at: "2026-11-12T15:00:00Z",
  created_at: new Date(Date.now() - 5_000).toISOString(),
  identities: [{ provider: "google" }],
  user_metadata: {},
  ...overrides,
});
const profile = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  companyId: "company-1",
  status: "ACTIVE",
  settings: {},
  role: { systemRole: "DRIVER" },
  company: { id: "company-1", status: "ACTIVE", isDemo: false },
  ...overrides,
});

test("Google : un compte existant entre dans son espace, choisi par le serveur d'après le rôle", async () => {
  const { completeGoogleLogin, calls } = loadService({ byAuthId: profile() });
  assert.deepEqual(await completeGoogleLogin(googleUser()), { kind: "signed-in", redirectTo: "/driver" });
  assert.equal(calls.updateMany.length, 0);
  assert.deepEqual(calls.deleted, []);
});

test("Google : une invitation en attente est acceptée avec les garde-fous du lien d'invitation", async () => {
  const pending = profile({ status: "PENDING_VERIFICATION" });
  const { completeGoogleLogin, calls } = loadService({ byAuthId: pending, sync: async () => profile() });
  assert.equal((await completeGoogleLogin(googleUser())).kind, "signed-in");
  assert.equal(calls.updateMany.length, 1);
  const where = (calls.updateMany[0] as { where: Record<string, unknown> }).where;
  assert.equal(where.authId, "auth-google");
  assert.equal(where.status, "PENDING_VERIFICATION");
  assert.deepEqual(where.company, { status: { in: ["ACTIVE", "TRIAL"] }, isDemo: false });
});

test("Google : une adresse inconnue est refusée et le compte Supabase vide est supprimé", async () => {
  const { completeGoogleLogin, calls } = loadService({
    byAuthId: null,
    sync: async () => { throw new UserNotProvisionedError(); },
  });
  assert.deepEqual(await completeGoogleLogin(googleUser()), { kind: "refused", reason: "unknown" });
  assert.deepEqual(calls.deleted, ["auth-google"]);
});

test("Google : un compte qui a aussi un mot de passe ou une inscription en cours n'est jamais supprimé", async () => {
  for (const user of [
    googleUser({ identities: [{ provider: "email" }, { provider: "google" }] }),
    googleUser({ user_metadata: { signup_flow: "managed" } }),
    googleUser({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() }),
  ]) {
    const { completeGoogleLogin, calls } = loadService({
      byAuthId: null,
      sync: async () => { throw new UserNotProvisionedError(); },
    });
    assert.equal((await completeGoogleLogin(user)).reason, "unknown");
    assert.deepEqual(calls.deleted, []);
  }
});

test("Google : un compte coupé ou une entreprise suspendue reste refusé, sans suppression", async () => {
  const { completeGoogleLogin, calls } = loadService({
    byAuthId: profile({ status: "SUSPENDED" }),
    sync: async () => { throw new AccountUnavailableError(); },
  });
  assert.deepEqual(await completeGoogleLogin(googleUser()), { kind: "refused", reason: "unavailable" });
  assert.equal(calls.updateMany.length, 0);
  assert.deepEqual(calls.deleted, []);
});

test("Google : une invitation d'une entreprise suspendue n'est pas activée", async () => {
  const pending = profile({ status: "PENDING_VERIFICATION", company: { id: "company-1", status: "SUSPENDED", isDemo: false } });
  const { completeGoogleLogin, calls } = loadService({
    byAuthId: pending,
    sync: async () => { throw new AccountUnavailableError(); },
  });
  assert.equal((await completeGoogleLogin(googleUser())).reason, "unavailable");
  // La garde de la requête refuse une entreprise hors ACTIVE/TRIAL : aucune activation possible.
  const where = (calls.updateMany[0] as { where: { company: { status: { in: string[] } } } }).where;
  assert.deepEqual(where.company.status.in, ["ACTIVE", "TRIAL"]);
});

test("Google : la démo n'ouvre jamais par Google", async () => {
  const demoProfile = loadService({ byAuthId: profile({ company: { id: "c", status: "ACTIVE", isDemo: true } }) });
  assert.deepEqual(await demoProfile.completeGoogleLogin(googleUser()), { kind: "refused", reason: "unavailable" });
  assert.equal(demoProfile.calls.synced, 0);
  const demoEmail = loadService({ byAuthId: profile() });
  assert.equal((await demoEmail.completeGoogleLogin(googleUser({ email: "demo@fixture.invalid" }))).reason, "unavailable");
});

test("Google : une adresse non vérifiée est refusée sans lecture du profil", async () => {
  const { completeGoogleLogin, calls } = loadService({ byAuthId: profile() });
  assert.deepEqual(await completeGoogleLogin(googleUser({ email_confirmed_at: null })), { kind: "refused", reason: "error" });
  assert.equal(calls.synced, 0);
});

test("Google : seul un compte né de ce clic, Google seul et de moins de dix minutes est jetable", () => {
  const { isDisposableGoogleOrphan } = loadService({});
  const fresh = new Date(NOW - 60_000).toISOString();
  assert.equal(isDisposableGoogleOrphan(googleUser({ created_at: fresh }), NOW), true);
  assert.equal(isDisposableGoogleOrphan(googleUser({ created_at: fresh, identities: [] }), NOW), false);
  assert.equal(isDisposableGoogleOrphan(googleUser({ created_at: null }), NOW), false);
  assert.equal(isDisposableGoogleOrphan(googleUser({ created_at: new Date(NOW + 60_000).toISOString() }), NOW), false);
});

function loadCallback(options: {
  exchange?: () => Promise<{ data: { user: unknown }; error: unknown }>;
  outcome?: () => Promise<unknown>;
}) {
  const calls = { signOut: 0, demoCleared: 0 };
  const route = loadModule<{ GET: (request: Request) => Promise<Response> }>("src/app/auth/callback/route.ts", {
    "next/server": { NextResponse },
    "@/services/supabase/server": {
      createClient: async () => ({
        auth: {
          exchangeCodeForSession: options.exchange ?? (async () => ({ data: { user: googleUser() }, error: null })),
          signOut: async () => { calls.signOut += 1; return { error: null }; },
        },
      }),
    },
    "@/domains/auth/google-login.service": {
      completeGoogleLogin: options.outcome ?? (async () => ({ kind: "signed-in", redirectTo: "/dashboard" })),
    },
    "@/lib/demo/persona-cookie": {
      clearDemoPersonaCookie: async () => { calls.demoCleared += 1; },
      clearDemoSessionCookie: async () => { calls.demoCleared += 1; },
    },
    "@/lib/auth/google-login": { GOOGLE_LOGIN_PARAM: "google", googleLoginReturnPath },
  });
  return { ...route, calls };
}

const callback = (query: string) => new Request(`https://tutelliv.fixture/auth/callback${query}`);

test("retour Google : sans code (annulation), retour à la connexion avec un message", async () => {
  const { GET, calls } = loadCallback({});
  const response = await GET(callback("?error=access_denied"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://tutelliv.fixture/login?google=error");
  assert.equal(calls.signOut, 0);
});

test("retour Google : un refus ferme la session et revient sur la page d'origine", async () => {
  const { GET, calls } = loadCallback({ outcome: async () => ({ kind: "refused", reason: "unknown" }) });
  const response = await GET(callback("?code=abc&from=/login/client"));
  assert.equal(response.headers.get("location"), "https://tutelliv.fixture/login/client?google=unknown");
  assert.equal(calls.signOut, 1);
});

test("retour Google : une page d'origine étrangère n'est jamais suivie", async () => {
  const { GET } = loadCallback({ outcome: async () => ({ kind: "refused", reason: "unavailable" }) });
  const response = await GET(callback("?code=abc&from=https://evil.fixture/login"));
  assert.equal(response.headers.get("location"), "https://tutelliv.fixture/login?google=unavailable");
});

test("retour Google : succès vers l'espace choisi par le serveur, traces de démo effacées", async () => {
  const { GET, calls } = loadCallback({ outcome: async () => ({ kind: "signed-in", redirectTo: "/portal" }) });
  const response = await GET(callback("?code=abc&from=/login/driver"));
  assert.equal(response.headers.get("location"), "https://tutelliv.fixture/portal");
  assert.equal(calls.signOut, 0);
  assert.equal(calls.demoCleared, 2);
});

test("retour Google : panne Supabase ou base injoignable = « indisponible », pas « refusé »", async () => {
  const auth = loadCallback({ exchange: async () => ({ data: { user: null }, error: { status: 503 } }) });
  assert.equal((await auth.GET(callback("?code=abc"))).headers.get("location"), "https://tutelliv.fixture/login?google=service");
  const db = loadCallback({ outcome: async () => { throw Object.assign(new Error("pool"), { code: "P2024" }); } });
  const response = await db.GET(callback("?code=abc"));
  assert.equal(response.headers.get("location"), "https://tutelliv.fixture/login?google=service");
  assert.equal(db.calls.signOut, 1);
});

test("connexion : seuls les refus connus s'affichent, et l'adresse inconnue renvoie à l'inscription", () => {
  assert.equal(googleRefusalFrom({ google: "unknown" }), "unknown");
  assert.equal(googleRefusalFrom({ google: ["service", "error"] }), "service");
  assert.equal(googleRefusalFrom({ google: "<script>" }), null);
  assert.equal(googleRefusalFrom({}), null);
  assert.match(GOOGLE_LOGIN_MESSAGES.unknown, /demandez-lui une invitation/);
  const form = readFileSync("src/features/auth/auth-form.tsx", "utf8");
  assert.match(form, /href="\/register"[^>]*>Créer un compte entreprise</);
});

function loadIdTokenRoute(options: {
  signIn?: (args: unknown) => Promise<{ data: { user: unknown }; error: unknown }>;
  outcome?: () => Promise<unknown>;
}) {
  const calls = { signOut: 0, demoCleared: 0, signInArgs: [] as unknown[] };
  const route = loadModule<{ POST: (request: Request) => Promise<Response> }>("src/app/api/auth/google/route.ts", {
    "next/server": { NextResponse },
    zod,
    "@/services/supabase/server": {
      createClient: async () => ({
        auth: {
          signInWithIdToken: async (args: unknown) => {
            calls.signInArgs.push(plain(args));
            return options.signIn ? options.signIn(args) : { data: { user: googleUser() }, error: null };
          },
          signOut: async () => { calls.signOut += 1; return { error: null }; },
        },
      }),
    },
    "@/domains/auth/google-login.service": {
      completeGoogleLogin: options.outcome ?? (async () => ({ kind: "signed-in", redirectTo: "/dashboard" })),
    },
    "@/lib/demo/persona-cookie": {
      clearDemoPersonaCookie: async () => { calls.demoCleared += 1; },
      clearDemoSessionCookie: async () => { calls.demoCleared += 1; },
    },
    "@/lib/auth/google-login": { GOOGLE_LOGIN_MESSAGES },
  });
  return { ...route, calls };
}

const idTokenRequest = (body: unknown) =>
  new Request("https://tutelliv.fixture/api/auth/google", { method: "POST", body: JSON.stringify(body) });
const validBody = { credential: "header.payload.signature-fixture", nonce: "0123456789abcdef0123456789abcdef" };

test("bouton Google : jeton et nonce bruts transmis à Supabase, succès vers l'espace du rôle", async () => {
  const { POST, calls } = loadIdTokenRoute({ outcome: async () => ({ kind: "signed-in", redirectTo: "/driver" }) });
  const response = await POST(idTokenRequest(validBody));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirectTo: "/driver" });
  assert.deepEqual(calls.signInArgs, [{ provider: "google", token: validBody.credential, nonce: validBody.nonce }]);
  assert.equal(calls.demoCleared, 2);
  assert.equal(calls.signOut, 0);
});

test("bouton Google : corps invalide refusé sans appel à Supabase", async () => {
  const { POST, calls } = loadIdTokenRoute({});
  for (const body of [null, {}, { credential: "court", nonce: validBody.nonce }, { credential: validBody.credential }]) {
    const response = await POST(idTokenRequest(body));
    assert.equal(response.status, 400);
  }
  assert.equal(calls.signInArgs.length, 0);
});

test("bouton Google : jeton refusé par Supabase (signature, audience, nonce) = erreur, panne = indisponible", async () => {
  const rejected = loadIdTokenRoute({ signIn: async () => ({ data: { user: null }, error: { status: 400 } }) });
  const response = await rejected.POST(idTokenRequest(validBody));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, "error");
  const down = loadIdTokenRoute({ signIn: async () => ({ data: { user: null }, error: { status: 502 } }) });
  assert.equal((await down.POST(idTokenRequest(validBody))).status, 503);
});

test("bouton Google : refus d'accès = session fermée, raison et message renvoyés", async () => {
  for (const [reason, status] of [["unknown", 403], ["unavailable", 403]] as const) {
    const { POST, calls } = loadIdTokenRoute({ outcome: async () => ({ kind: "refused", reason }) });
    const response = await POST(idTokenRequest(validBody));
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.reason, reason);
    assert.equal(body.error, GOOGLE_LOGIN_MESSAGES[reason]);
    assert.equal(calls.signOut, 1);
    assert.equal(calls.demoCleared, 0);
  }
  const db = loadIdTokenRoute({ outcome: async () => { throw Object.assign(new Error("pool"), { code: "P2024" }); } });
  assert.equal((await db.POST(idTokenRequest(validBody))).status, 503);
  assert.equal(db.calls.signOut, 1);
});
