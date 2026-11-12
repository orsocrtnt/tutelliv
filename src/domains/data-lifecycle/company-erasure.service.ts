import { createHash } from "node:crypto";
import { Prisma, type CompanyStatus, type SystemRole } from "@prisma/client";
import { prisma } from "@/services/prisma/client";
import { createAdminClient } from "@/services/supabase/admin";
import { hasCrossTenantDemoReference } from "@/domains/data-lifecycle/demo-cleanup.service";
import { loadFacturXInvoice, renderClassicInvoicePdf } from "@/domains/invoice/facturx/facturx.service";
import { buildFacturXPdf } from "@/domains/invoice/facturx/facturx-document";
import { COMPANY_LIFECYCLE_SETTINGS_KEY } from "@/domains/data-lifecycle/company-lifecycle-key";

export { COMPANY_LIFECYCLE_SETTINGS_KEY };

/**
 * DATA-02 — effacement d'une entreprise pilote 30 jours après la confirmation de son export
 * (`docs/operations/data02/RETENTION_POLICY_DRAFT.md`, durées validées le 9 novembre 2026).
 *
 * Plan : accès coupé (statut SUSPENDED) → export confirmé et daté → 30 jours → effacement.
 * Gardé (décision du propriétaire du 11 novembre 2026) : la fiche entreprise réduite à son identité
 * de facturation, ses factures figées en PDF (bucket privé `invoice-archives`) et les traces du contrat
 * SaaS. Effacé : comptes (base et Supabase Auth), commandes, livraisons, GPS, preuves, logo, échanges.
 *
 * Jamais automatique : la politique interdit une suppression automatique définitive de données réelles
 * avant validation juridique. Seul un script opérateur appelle `eraseCompany`, simulation par défaut.
 * Rejouable : stockage puis Auth puis base ; un objet ou un compte déjà absent n'est pas une erreur.
 */

export const COMPANY_ERASURE_AUTHORIZATION = "pilot-company-erasure-v1";
export const COMPANY_ERASURE_DELAY_MS = 30 * 24 * 60 * 60 * 1000;
export const INVOICE_ARCHIVE_BUCKET = "invoice-archives";
const POD_BUCKET = "delivery-pods";
const LOGO_BUCKET = "company-logos";
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const PAGE_SIZE = 100;

export interface CompanyLifecycle {
  exportConfirmedAt: string;
  eraseNotBefore: string;
  scheduledAt: string;
  erasedAt?: string;
  manifest?: CompanyErasureManifest;
}

export interface ArchivedInvoice {
  invoiceId: string;
  path: string;
  format: "facturx" | "classic";
  bytes: number;
  sha256: string;
}

export interface CompanyErasureManifest {
  schema: "tutelliv-company-erasure";
  version: 1;
  companyId: string;
  exportConfirmedAt: string;
  eraseNotBefore: string;
  erasedAt: string;
  deleted: Record<string, number>;
  kept: { invoices: number; invoiceArchives: ArchivedInvoice[]; companyIdentity: true; saasRecords: true };
}

export interface ErasurePlan {
  company: { id: string; isDemo: boolean; status: CompanyStatus; settings: Prisma.JsonValue | null };
  users: { id: string; authId: string; systemRole: SystemRole }[];
  runningJobs: number;
  crossTenant: boolean;
  invoices: { id: string; pdfUrl: string | null }[];
  storage: { proofs: string[]; logos: string[]; subfolders: number };
}

export type ErasureResult =
  | { status: "missing" }
  | { status: "blocked"; reason: string }
  | { status: "eligible"; summary: ErasureSummary }
  | { status: "erased"; manifest: CompanyErasureManifest };

export interface ErasureSummary {
  users: number;
  invoicesToArchive: number;
  invoicesAlreadyArchived: number;
  proofObjects: number;
  logoObjects: number;
}

export interface ErasureDeps {
  loadPlan(companyId: string): Promise<ErasurePlan | null>;
  archiveInvoice(companyId: string, invoiceId: string): Promise<ArchivedInvoice>;
  verifyArchivedInvoice(companyId: string, invoiceId: string): Promise<ArchivedInvoice>;
  removeStorageObjects(bucket: string, paths: string[]): Promise<void>;
  deleteAuthUser(authId: string): Promise<"deleted" | "missing">;
  purgeDatabase(input: PurgeInput): Promise<Record<string, number>>;
}

export interface PurgeInput {
  companyId: string;
  expectedUserIds: string[];
  eraseNotBefore: string;
  now: Date;
  buildManifest: (deleted: Record<string, number>) => CompanyErasureManifest;
}

class ErasureBlocked extends Error {}

function settingsObject(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, Prisma.JsonValue>) } : {};
}

export function readCompanyLifecycle(settings: Prisma.JsonValue | null | undefined): CompanyLifecycle | null {
  const raw = settingsObject(settings)[COMPANY_LIFECYCLE_SETTINGS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const dates = [value.exportConfirmedAt, value.eraseNotBefore, value.scheduledAt];
  if (!dates.every((date) => typeof date === "string" && Number.isFinite(Date.parse(date)))) return null;
  return value as unknown as CompanyLifecycle;
}

export function invoiceArchivePath(companyId: string, invoiceId: string): string {
  if (!SAFE_ID.test(companyId) || !SAFE_ID.test(invoiceId)) throw new Error("INVALID_ID");
  return `${companyId}/${invoiceId}.pdf`;
}

/** Garde pure : la première raison qui interdit l'effacement, ou null. */
export function erasureBlockReason(plan: ErasurePlan, now: Date): string | null {
  const lifecycle = readCompanyLifecycle(plan.company.settings);
  if (plan.company.isDemo) return "DEMO_COMPANY";
  if (lifecycle?.erasedAt) return "ALREADY_ERASED";
  if (plan.company.status !== "SUSPENDED") return "ACCESS_NOT_CUT";
  if (!lifecycle) return "NOT_SCHEDULED";
  if (Date.parse(lifecycle.eraseNotBefore) > now.getTime()) return "DELAY_NOT_ELAPSED";
  if (plan.users.some((user) => user.systemRole === "SUPER_ADMIN")) return "PROTECTED_ACCOUNT";
  if (plan.runningJobs > 0) return "UNFINISHED_JOBS";
  if (plan.crossTenant) return "CROSS_TENANT_REFERENCE";
  if (plan.storage.subfolders > 0) return "UNEXPECTED_STORAGE_FOLDER";
  const foreignFile = plan.invoices.some((invoice) =>
    invoice.pdfUrl !== null && invoice.pdfUrl !== invoiceArchivePath(plan.company.id, invoice.id));
  if (foreignFile) return "UNKNOWN_INVOICE_FILE";
  return null;
}

/**
 * Étape 1, une fois l'export remis et confirmé par l'entreprise : date l'export et fixe la date
 * d'effacement à +30 jours. L'accès doit déjà être coupé (« Couper l'accès » dans /admin) ;
 * le rétablir annule ce calendrier (voir `setPlatformCompanyAccess`).
 */
export async function scheduleCompanyErasure(companyId: string, input: { exportConfirmedAt: Date; now?: Date }):
  Promise<{ ok: true; lifecycle: CompanyLifecycle } | { ok: false; reason: string }> {
  const now = input.now ?? new Date();
  const confirmed = input.exportConfirmedAt;
  if (!Number.isFinite(confirmed.getTime()) || !Number.isFinite(now.getTime())) return { ok: false, reason: "INVALID_TIME" };
  if (confirmed.getTime() > now.getTime()) return { ok: false, reason: "EXPORT_IN_FUTURE" };
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { isDemo: true, status: true, settings: true } });
  if (!company) return { ok: false, reason: "MISSING" };
  if (company.isDemo) return { ok: false, reason: "DEMO_COMPANY" };
  if (readCompanyLifecycle(company.settings)?.erasedAt) return { ok: false, reason: "ALREADY_ERASED" };
  if (company.status !== "SUSPENDED") return { ok: false, reason: "ACCESS_NOT_CUT" };
  const lifecycle: CompanyLifecycle = {
    exportConfirmedAt: confirmed.toISOString(),
    eraseNotBefore: new Date(confirmed.getTime() + COMPANY_ERASURE_DELAY_MS).toISOString(),
    scheduledAt: now.toISOString(),
  };
  const settings = settingsObject(company.settings);
  settings[COMPANY_LIFECYCLE_SETTINGS_KEY] = lifecycle as unknown as Prisma.JsonValue;
  const expected = company.settings === null ? Prisma.DbNull : (company.settings as Prisma.InputJsonValue);
  const result = await prisma.company.updateMany({
    where: { id: companyId, status: "SUSPENDED", settings: { equals: expected } },
    data: { settings: settings as Prisma.InputJsonValue },
  });
  return result.count === 1 ? { ok: true, lifecycle } : { ok: false, reason: "CONCURRENT_CHANGE" };
}

/** Étape 2 : simulation par défaut ; `apply` exige l'autorisation explicite. */
export async function eraseCompany(
  companyId: string,
  options: { apply?: boolean; authorization?: string; now?: Date } = {},
  deps: ErasureDeps = defaultErasureDeps,
): Promise<ErasureResult> {
  if (!SAFE_ID.test(companyId)) return { status: "blocked", reason: "INVALID_ID" };
  if (options.apply && options.authorization !== COMPANY_ERASURE_AUTHORIZATION) {
    return { status: "blocked", reason: "EXPLICIT_ACTIVATION_REQUIRED" };
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) return { status: "blocked", reason: "INVALID_TIME" };

  const plan = await deps.loadPlan(companyId);
  if (!plan) return { status: "missing" };
  const reason = erasureBlockReason(plan, now);
  if (reason) return { status: "blocked", reason };
  const lifecycle = readCompanyLifecycle(plan.company.settings)!;
  const archivedPath = (id: string) => invoiceArchivePath(companyId, id);
  const pending = plan.invoices.filter((invoice) => invoice.pdfUrl !== archivedPath(invoice.id));
  if (!options.apply) {
    return {
      status: "eligible",
      summary: {
        users: plan.users.length,
        invoicesToArchive: pending.length,
        invoicesAlreadyArchived: plan.invoices.length - pending.length,
        proofObjects: plan.storage.proofs.length,
        logoObjects: plan.storage.logos.length,
      },
    };
  }

  try {
    // 1. Factures figées en PDF, tant que clients et logo existent encore.
    const archives: ArchivedInvoice[] = [];
    for (const invoice of plan.invoices) {
      archives.push(invoice.pdfUrl === archivedPath(invoice.id)
        ? await deps.verifyArchivedInvoice(companyId, invoice.id)
        : await deps.archiveInvoice(companyId, invoice.id));
    }
    // 2. Preuves et logo. 3. Comptes Supabase Auth. 4. Base, en dernier et sous transaction.
    await deps.removeStorageObjects(POD_BUCKET, plan.storage.proofs);
    await deps.removeStorageObjects(LOGO_BUCKET, plan.storage.logos);
    let authDeleted = 0;
    let authMissing = 0;
    for (const user of plan.users) {
      if ((await deps.deleteAuthUser(user.authId)) === "deleted") authDeleted++;
      else authMissing++;
    }
    const erasedAt = now.toISOString();
    let manifest: CompanyErasureManifest | undefined;
    await deps.purgeDatabase({
      companyId,
      expectedUserIds: plan.users.map((user) => user.id),
      eraseNotBefore: lifecycle.eraseNotBefore,
      now,
      buildManifest: (deleted) => (manifest = {
        schema: "tutelliv-company-erasure",
        version: 1,
        companyId,
        exportConfirmedAt: lifecycle.exportConfirmedAt,
        eraseNotBefore: lifecycle.eraseNotBefore,
        erasedAt,
        deleted: {
          ...deleted,
          authAccounts: authDeleted,
          authAccountsAlreadyMissing: authMissing,
          proofObjects: plan.storage.proofs.length,
          logoObjects: plan.storage.logos.length,
        },
        kept: { invoices: archives.length, invoiceArchives: archives, companyIdentity: true, saasRecords: true },
      }),
    });
    return { status: "erased", manifest: manifest! };
  } catch (error) {
    if (error instanceof ErasureBlocked) return { status: "blocked", reason: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Dépendances réelles (Prisma, Supabase Storage et Auth)
// ---------------------------------------------------------------------------

async function listFolder(bucket: string, companyId: string): Promise<{ files: string[]; subfolders: number }> {
  const storage = createAdminClient().storage;
  const files: string[] = [];
  let subfolders = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await storage.from(bucket).list(companyId, {
      limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      // Bucket jamais créé : rien à effacer dedans.
      if (/not found/i.test(error.message)) break;
      throw new Error("ERASURE_STORAGE_UNAVAILABLE");
    }
    for (const row of data ?? []) {
      if (row.id === null) subfolders++;
      else files.push(`${companyId}/${row.name}`);
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { files, subfolders };
}

let archiveBucketReady: Promise<void> | null = null;
async function ensureInvoiceArchiveBucket() {
  if (!archiveBucketReady) {
    archiveBucketReady = (async () => {
      const storage = createAdminClient().storage;
      const { data, error } = await storage.listBuckets();
      if (error) throw new Error("ERASURE_STORAGE_UNAVAILABLE");
      const bucket = data?.find((item) => item.name === INVOICE_ARCHIVE_BUCKET);
      if (bucket) {
        if (bucket.public) throw new Error("INVOICE_ARCHIVE_PUBLIC");
        return;
      }
      const created = await storage.createBucket(INVOICE_ARCHIVE_BUCKET, {
        public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ["application/pdf"],
      });
      if (created.error) throw new Error("ERASURE_STORAGE_UNAVAILABLE");
    })().catch((error) => { archiveBucketReady = null; throw error; });
  }
  await archiveBucketReady;
}

function describe(invoiceId: string, path: string, format: ArchivedInvoice["format"], bytes: Uint8Array): ArchivedInvoice {
  return { invoiceId, path, format, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";

export const defaultErasureDeps: ErasureDeps = {
  async loadPlan(companyId) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, isDemo: true, status: true, settings: true },
    });
    if (!company) return null;
    const [users, runningJobs, invoices] = await Promise.all([
      prisma.user.findMany({ where: { companyId }, select: { id: true, authId: true, role: { select: { systemRole: true } } } }),
      prisma.operationJob.count({ where: { companyId, status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.invoice.findMany({ where: { companyId }, select: { id: true, pdfUrl: true }, orderBy: { createdAt: "asc" } }),
    ]);
    const crossTenant = await hasCrossTenantDemoReference(prisma as unknown as Prisma.TransactionClient, companyId, users.map((user) => user.id));
    const [proofs, logos] = await Promise.all([listFolder(POD_BUCKET, companyId), listFolder(LOGO_BUCKET, companyId)]);
    return {
      company,
      users: users.map((user) => ({ id: user.id, authId: user.authId, systemRole: user.role.systemRole })),
      runningJobs,
      crossTenant,
      invoices,
      storage: { proofs: proofs.files, logos: logos.files, subfolders: proofs.subfolders + logos.subfolders },
    };
  },

  async archiveInvoice(companyId, invoiceId) {
    const loaded = await loadFacturXInvoice({ invoiceId, companyId });
    if (!loaded) throw new ErasureBlocked("INVOICE_NOT_FOUND");
    let format: ArchivedInvoice["format"] = "classic";
    let pdf: Uint8Array | null = null;
    if (loaded.source) {
      const result = await buildFacturXPdf({
        source: loaded.source, renderClassicPdf: (legal) => renderClassicInvoicePdf(loaded, legal), now: new Date(),
      });
      if (result.ok) { pdf = result.pdf; format = "facturx"; }
    }
    pdf ??= await renderClassicInvoicePdf(loaded);
    if (!isPdf(pdf)) throw new Error("INVOICE_ARCHIVE_INVALID_PDF");
    await ensureInvoiceArchiveBucket();
    const path = invoiceArchivePath(companyId, invoiceId);
    // upsert : un essai précédent interrompu avant l'enregistrement du chemin peut avoir laissé l'objet.
    const { error } = await createAdminClient().storage.from(INVOICE_ARCHIVE_BUCKET).upload(path, Buffer.from(pdf), {
      contentType: "application/pdf", upsert: true,
    });
    if (error) throw new Error("INVOICE_ARCHIVE_UPLOAD_FAILED");
    const marked = await prisma.invoice.updateMany({ where: { id: invoiceId, companyId, pdfUrl: null }, data: { pdfUrl: path } });
    if (marked.count !== 1) throw new ErasureBlocked("CONCURRENT_CHANGE");
    return describe(invoiceId, path, format, pdf);
  },

  async verifyArchivedInvoice(companyId, invoiceId) {
    const path = invoiceArchivePath(companyId, invoiceId);
    const { data, error } = await createAdminClient().storage.from(INVOICE_ARCHIVE_BUCKET).download(path);
    if (error || !data) throw new ErasureBlocked("ARCHIVED_INVOICE_MISSING");
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (!isPdf(bytes)) throw new ErasureBlocked("ARCHIVED_INVOICE_INVALID");
    const facturx = Buffer.from(bytes).includes("factur-x.xml");
    return describe(invoiceId, path, facturx ? "facturx" : "classic", bytes);
  },

  async removeStorageObjects(bucket, paths) {
    const storage = createAdminClient().storage.from(bucket);
    for (let start = 0; start < paths.length; start += PAGE_SIZE) {
      const { error } = await storage.remove(paths.slice(start, start + PAGE_SIZE));
      if (error) throw new Error("ERASURE_STORAGE_UNAVAILABLE");
    }
  },

  async deleteAuthUser(authId) {
    const { error } = await createAdminClient().auth.admin.deleteUser(authId);
    if (!error) return "deleted";
    if (error.status === 404) return "missing";
    throw new Error("ERASURE_AUTH_DELETE_FAILED");
  },

  async purgeDatabase({ companyId, expectedUserIds, eraseNotBefore, now, buildManifest }) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const company = await tx.company.findUnique({ where: { id: companyId } });
          if (!company) throw new ErasureBlocked("MISSING");
          const lifecycle = readCompanyLifecycle(company.settings);
          if (company.isDemo || company.status !== "SUSPENDED" || lifecycle?.erasedAt || lifecycle?.eraseNotBefore !== eraseNotBefore) {
            throw new ErasureBlocked("CONCURRENT_CHANGE");
          }
          const users = await tx.user.findMany({ where: { companyId }, select: { id: true } });
          const expected = new Set(expectedUserIds);
          if (users.length !== expected.size || users.some((user) => !expected.has(user.id))) throw new ErasureBlocked("CONCURRENT_CHANGE");
          if (await tx.operationJob.count({ where: { companyId, status: { in: ["PENDING", "PROCESSING"] } } })) throw new ErasureBlocked("UNFINISHED_JOBS");
          if (await hasCrossTenantDemoReference(tx, companyId, expectedUserIds)) throw new ErasureBlocked("CROSS_TENANT_REFERENCE");
          const unarchived = await tx.invoice.count({ where: { companyId, OR: [{ pdfUrl: null }, { pdfUrl: { not: { startsWith: `${companyId}/` } } }] } });
          if (unarchived) throw new ErasureBlocked("INVOICE_NOT_ARCHIVED");

          // Ordre imposé par les clés : commandes (messages, livraisons, suivis en cascade) avant comptes.
          const deleted: Record<string, number> = {};
          const userIds = { in: expectedUserIds };
          deleted.driverLocations = (await tx.driverLocation.deleteMany({ where: { driverId: userIds } })).count;
          deleted.customerAddresses = (await tx.customerAddress.deleteMany({ where: { userId: userIds } })).count;
          deleted.operationJobs = (await tx.operationJob.deleteMany({ where: { companyId } })).count;
          deleted.supportTickets = (await tx.supportTicket.deleteMany({ where: { companyId } })).count;
          deleted.invoiceReminders = (await tx.invoiceReminder.deleteMany({ where: { companyId } })).count;
          deleted.deliveries = (await tx.delivery.count({ where: { companyId } }));
          deleted.orders = (await tx.order.deleteMany({ where: { companyId } })).count;
          await tx.delivery.deleteMany({ where: { companyId } });
          deleted.recurringOrders = (await tx.recurringOrder.deleteMany({ where: { companyId } })).count;
          deleted.companyCustomers = (await tx.companyCustomer.deleteMany({ where: { companyId } })).count;
          deleted.trackingLinks = (await tx.orderTrackingLink.deleteMany({ where: { companyId } })).count;
          deleted.inboundEmails = (await tx.inboundOrderEmail.deleteMany({ where: { companyId } })).count;
          deleted.intakeChannels = (await tx.companyIntakeChannel.deleteMany({ where: { companyId } })).count;
          deleted.pushSubscriptions = (await tx.driverPushSubscription.deleteMany({ where: { companyId } })).count;
          deleted.signupJourneys = (await tx.signupJourney.deleteMany({ where: { companyId } })).count;
          deleted.users = (await tx.user.deleteMany({ where: { companyId } })).count;

          const manifest = buildManifest(deleted);
          const settings: Record<string, Prisma.JsonValue> = {
            [COMPANY_LIFECYCLE_SETTINGS_KEY]: { ...lifecycle, erasedAt: manifest.erasedAt, manifest } as unknown as Prisma.JsonValue,
          };
          // Identité de facturation gardée (figée aussi dans les PDF) ; contacts, logo et réglages effacés.
          // Réclamation sur les réglages relus dans la transaction : une écriture concurrente annule tout.
          const expectedSettings = company.settings === null ? Prisma.DbNull : (company.settings as Prisma.InputJsonValue);
          const written = await tx.company.updateMany({
            where: { id: companyId, status: "SUSPENDED", settings: { equals: expectedSettings } },
            data: { status: "INACTIVE", email: null, phone: null, address: null, city: null, logoUrl: null, settings: settings as Prisma.InputJsonValue, updatedAt: now },
          });
          if (written.count !== 1) throw new ErasureBlocked("CONCURRENT_CHANGE");
          return deleted;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error("ERASURE_RETRY_EXHAUSTED");
  },
};
