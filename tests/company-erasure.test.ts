import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPANY_ERASURE_AUTHORIZATION,
  eraseCompany,
  erasureBlockReason,
  invoiceArchivePath,
  readCompanyLifecycle,
  replayRegisteredErasure,
  type CompanyErasureManifest,
  type ReplayDeps,
  type ErasureDeps,
  type ErasurePlan,
} from "../src/domains/data-lifecycle/company-erasure.service";

const NOW = new Date("2026-12-15T12:00:00.000Z");
const lifecycle = {
  exportConfirmedAt: "2026-11-01T10:00:00.000Z",
  eraseNotBefore: "2026-12-01T10:00:00.000Z",
  scheduledAt: "2026-11-01T10:05:00.000Z",
};

function plan(overrides: Partial<ErasurePlan> = {}, company: Partial<ErasurePlan["company"]> = {}): ErasurePlan {
  return {
    company: { id: "co_a", isDemo: false, status: "SUSPENDED", settings: { dataLifecycle: lifecycle, billing: { x: 1 } }, ...company },
    users: [
      { id: "u1", authId: "auth-1", systemRole: "COMPANY_ADMIN" },
      { id: "u2", authId: "auth-2", systemRole: "DRIVER" },
    ],
    runningJobs: 0,
    crossTenant: false,
    invoices: [{ id: "inv1", pdfUrl: null }, { id: "inv2", pdfUrl: "co_a/inv2.pdf" }],
    storage: { proofs: ["co_a/d1-1.jpg"], logos: ["co_a/logo-x.png"], exports: ["co_a/x-1.zip"], subfolders: 0 },
    ...overrides,
  };
}

function fakeDeps(p: ErasurePlan | null, calls: string[], overrides: Partial<ErasureDeps> = {}): ErasureDeps {
  return {
    loadPlan: async () => p,
    archiveInvoice: async (_c, id) => { calls.push(`archive:${id}`); return { invoiceId: id, path: `co_a/${id}.pdf`, format: "facturx", bytes: 10, sha256: "a" }; },
    verifyArchivedInvoice: async (_c, id) => { calls.push(`verify:${id}`); return { invoiceId: id, path: `co_a/${id}.pdf`, format: "classic", bytes: 9, sha256: "b" }; },
    removeStorageObjects: async (bucket, paths) => { calls.push(`storage:${bucket}:${paths.length}`); },
    deleteAuthUser: async (authId) => { calls.push(`auth:${authId}`); return authId === "auth-2" ? "missing" : "deleted"; },
    purgeDatabase: async (input) => {
      calls.push(`db:${input.expectedUserIds.join(",")}`);
      const deleted = { users: 2, orders: 3 };
      input.buildManifest(deleted);
      return deleted;
    },
    ...overrides,
  };
}

test("garde : chaque condition manquante bloque, dans l'ordre attendu", () => {
  assert.equal(erasureBlockReason(plan(), NOW), null);
  assert.equal(erasureBlockReason(plan({}, { isDemo: true }), NOW), "DEMO_COMPANY");
  assert.equal(erasureBlockReason(plan({}, { settings: { dataLifecycle: { ...lifecycle, erasedAt: "2026-12-02T00:00:00.000Z" } } }), NOW), "ALREADY_ERASED");
  assert.equal(erasureBlockReason(plan({}, { status: "ACTIVE" }), NOW), "ACCESS_NOT_CUT");
  assert.equal(erasureBlockReason(plan({}, { settings: {} }), NOW), "NOT_SCHEDULED");
  assert.equal(erasureBlockReason(plan(), new Date("2026-12-01T09:59:59.000Z")), "DELAY_NOT_ELAPSED");
  assert.equal(erasureBlockReason(plan({ users: [{ id: "s", authId: "s", systemRole: "SUPER_ADMIN" }] }), NOW), "PROTECTED_ACCOUNT");
  assert.equal(erasureBlockReason(plan({ runningJobs: 1 }), NOW), "UNFINISHED_JOBS");
  assert.equal(erasureBlockReason(plan({ crossTenant: true }), NOW), "CROSS_TENANT_REFERENCE");
  assert.equal(erasureBlockReason(plan({ storage: { proofs: [], logos: [], exports: [], subfolders: 1 } }), NOW), "UNEXPECTED_STORAGE_FOLDER");
  assert.equal(erasureBlockReason(plan({ invoices: [{ id: "inv1", pdfUrl: "co_b/inv1.pdf" }] }), NOW), "UNKNOWN_INVOICE_FILE");
});

test("calendrier : une valeur mal formée n'est jamais lue comme programmée", () => {
  assert.equal(readCompanyLifecycle(null), null);
  assert.equal(readCompanyLifecycle({ dataLifecycle: { ...lifecycle, eraseNotBefore: "demain" } }), null);
  assert.equal(readCompanyLifecycle({ dataLifecycle: [] }), null);
  assert.equal(readCompanyLifecycle({ dataLifecycle: lifecycle })?.eraseNotBefore, lifecycle.eraseNotBefore);
  assert.throws(() => invoiceArchivePath("co/../b", "inv"), /INVALID_ID/);
});

test("simulation : aucune écriture, un résumé chiffré", async () => {
  const calls: string[] = [];
  const result = await eraseCompany("co_a", { now: NOW }, fakeDeps(plan(), calls));
  assert.deepEqual(calls, []);
  assert.deepEqual(result, {
    status: "eligible",
    summary: { users: 2, invoicesToArchive: 1, invoicesAlreadyArchived: 1, proofObjects: 1, logoObjects: 1, exportObjects: 1 },
  });
});

test("application sans autorisation exacte : refusée avant toute lecture", async () => {
  const calls: string[] = [];
  let loaded = false;
  const deps = fakeDeps(plan(), calls, { loadPlan: async () => { loaded = true; return plan(); } });
  assert.deepEqual(await eraseCompany("co_a", { apply: true, now: NOW }, deps), { status: "blocked", reason: "EXPLICIT_ACTIVATION_REQUIRED" });
  assert.deepEqual(await eraseCompany("co_a", { apply: true, authorization: "oui", now: NOW }, deps), { status: "blocked", reason: "EXPLICIT_ACTIVATION_REQUIRED" });
  assert.equal(loaded, false);
  assert.deepEqual(calls, []);
});

test("application : factures figées d'abord, puis stockage, Auth et base en dernier", async () => {
  const calls: string[] = [];
  const result = await eraseCompany("co_a", { apply: true, authorization: COMPANY_ERASURE_AUTHORIZATION, now: NOW }, fakeDeps(plan(), calls));
  assert.deepEqual(calls, [
    "archive:inv1",
    "verify:inv2",
    "storage:delivery-pods:1",
    "storage:company-logos:1",
    "storage:company-exports:1",
    "auth:auth-1",
    "auth:auth-2",
    "db:u1,u2",
  ]);
  assert.equal(result.status, "erased");
  if (result.status !== "erased") return;
  assert.equal(result.manifest.erasedAt, NOW.toISOString());
  assert.equal(result.manifest.exportConfirmedAt, lifecycle.exportConfirmedAt);
  assert.deepEqual(result.manifest.deleted, {
    users: 2, orders: 3, authAccounts: 1, authAccountsAlreadyMissing: 1, proofObjects: 1, logoObjects: 1, exportObjects: 1,
  });
  assert.equal(result.manifest.kept.invoices, 2);
  // Le manifeste ne porte aucun identifiant de compte ni chemin de preuve.
  const serialized = JSON.stringify(result.manifest);
  assert.equal(serialized.includes("auth-1"), false);
  assert.equal(serialized.includes("d1-1.jpg"), false);
});

test("panne de stockage : ni Auth ni base touchés, l'erreur remonte pour une reprise", async () => {
  const calls: string[] = [];
  const deps = fakeDeps(plan(), calls, {
    removeStorageObjects: async () => { throw new Error("ERASURE_STORAGE_UNAVAILABLE"); },
  });
  await assert.rejects(eraseCompany("co_a", { apply: true, authorization: COMPANY_ERASURE_AUTHORIZATION, now: NOW }, deps), /ERASURE_STORAGE_UNAVAILABLE/);
  assert.equal(calls.some((call) => call.startsWith("auth:") || call.startsWith("db:")), false);
});

test("entreprise absente, identifiant douteux ou délai non écoulé : rien n'est fait", async () => {
  const calls: string[] = [];
  assert.deepEqual(await eraseCompany("co_a", { now: NOW }, fakeDeps(null, calls)), { status: "missing" });
  assert.deepEqual(await eraseCompany("../co", { now: NOW }, fakeDeps(plan(), calls)), { status: "blocked", reason: "INVALID_ID" });
  assert.deepEqual(
    await eraseCompany("co_a", { apply: true, authorization: COMPANY_ERASURE_AUTHORIZATION, now: new Date("2026-11-20T00:00:00.000Z") }, fakeDeps(plan(), calls)),
    { status: "blocked", reason: "DELAY_NOT_ELAPSED" },
  );
  assert.deepEqual(calls, []);
});

// Reprise après restauration d'une sauvegarde (registre hors base).
const registered: CompanyErasureManifest = {
  schema: "tutelliv-company-erasure", version: 1, companyId: "co_a",
  exportConfirmedAt: lifecycle.exportConfirmedAt, eraseNotBefore: lifecycle.eraseNotBefore, erasedAt: "2026-12-02T08:00:00.000Z",
  deleted: { users: 2 }, kept: { invoices: 0, invoiceArchives: [], companyIdentity: true, saasRecords: true },
};

function replayDeps(company: Awaited<ReturnType<ReplayDeps["loadCompany"]>>, calls: string[], rescheduled = true): ReplayDeps {
  return {
    loadCompany: async () => company,
    reschedule: async (id, _previous, next) => { calls.push(`reschedule:${id}:${next.eraseNotBefore}:${next.scheduledAt}`); return rescheduled; },
    erase: async (id, options) => { calls.push(`erase:${id}:${options.apply}`); return { status: "erased", manifest: { ...registered, erasedAt: options.now.toISOString() } }; },
  };
}

test("reprise : entreprise revenue avec une sauvegarde → accès recoupé, calendrier d'origine, effacement", async () => {
  const calls: string[] = [];
  // Sauvegarde antérieure à la coupure : entreprise active, sans calendrier.
  const restored = { isDemo: false, settings: { billing: { x: 1 } } };
  assert.deepEqual(await replayRegisteredErasure(registered, { now: NOW }, replayDeps(restored, calls)), { status: "to_erase" });
  assert.deepEqual(calls, []);
  const result = await replayRegisteredErasure(registered, { apply: true, authorization: COMPANY_ERASURE_AUTHORIZATION, now: NOW }, replayDeps(restored, calls));
  assert.equal(result.status, "erased");
  assert.deepEqual(calls, [`reschedule:co_a:${lifecycle.eraseNotBefore}:${NOW.toISOString()}`, "erase:co_a:true"]);
});

test("reprise : déjà effacée, absente, démo, entrée invalide ou autorisation absente → rien n'est fait", async () => {
  const calls: string[] = [];
  const erased = { isDemo: false, settings: { dataLifecycle: { ...lifecycle, erasedAt: registered.erasedAt } } };
  const apply = { apply: true, authorization: COMPANY_ERASURE_AUTHORIZATION, now: NOW };
  assert.deepEqual(await replayRegisteredErasure(registered, apply, replayDeps(erased, calls)), { status: "already_erased" });
  assert.deepEqual(await replayRegisteredErasure(registered, apply, replayDeps(null, calls)), { status: "absent" });
  assert.deepEqual(await replayRegisteredErasure(registered, apply, replayDeps({ isDemo: true, settings: null }, calls)), { status: "blocked", reason: "DEMO_COMPANY" });
  assert.deepEqual(await replayRegisteredErasure({ ...registered, companyId: "../x" }, apply, replayDeps(erased, calls)), { status: "blocked", reason: "INVALID_REGISTRY_ENTRY" });
  assert.deepEqual(await replayRegisteredErasure(registered, { apply: true, now: NOW }, replayDeps({ isDemo: false, settings: null }, calls)), { status: "blocked", reason: "EXPLICIT_ACTIVATION_REQUIRED" });
  assert.deepEqual(await replayRegisteredErasure(registered, apply, replayDeps({ isDemo: false, settings: null }, calls, false)), { status: "blocked", reason: "CONCURRENT_CHANGE" });
  assert.equal(calls.some((call) => call.startsWith("erase:")), false);
});
