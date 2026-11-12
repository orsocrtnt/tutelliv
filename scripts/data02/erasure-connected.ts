import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/services/prisma/client";
import { createAdminClient } from "../../src/services/supabase/admin";
import { uploadPodPhoto } from "../../src/lib/storage/pod";
import { uploadCompanyLogo } from "../../src/lib/storage/company-logo";
import { setPlatformCompanyAccess } from "../../src/domains/admin/account-access.service";
import {
  COMPANY_ERASURE_AUTHORIZATION,
  INVOICE_ARCHIVE_BUCKET,
  eraseCompany,
  readCompanyLifecycle,
  scheduleCompanyErasure,
} from "../../src/domains/data-lifecycle/company-erasure.service";

/**
 * DATA-02, exercice A/B sur la base de développement : l'entreprise A (fixture non démo, vrais comptes
 * Supabase Auth, preuve, logo, facture) est effacée ; l'entreprise B doit rester identique.
 * Tout est créé ici avec un préfixe aléatoire `data02-erase-…` et nettoyé à la fin.
 */
let png = Buffer.alloc(0);
const outputPath = resolve(process.argv[2] ?? "outputs/data02/erasure-connected.json");
const fixtureKey = `data02-erase-${randomUUID()}`;
const createdAuthIds: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

async function roleIds() {
  const rows = await prisma.role.findMany({ where: { systemRole: { in: ["COMPANY_ADMIN", "CLIENT", "DRIVER"] } }, select: { id: true, systemRole: true } });
  const roles = Object.fromEntries(rows.map((row) => [row.systemRole, row.id]));
  assert.ok(roles.COMPANY_ADMIN && roles.CLIENT && roles.DRIVER, "ROLES_MISSING");
  return roles as Record<"COMPANY_ADMIN" | "CLIENT" | "DRIVER", string>;
}

async function authId(email: string, real: boolean) {
  if (!real) return `${fixtureKey}-${randomUUID()}`;
  const { data, error } = await createAdminClient().auth.admin.createUser({ email, password: `Aa1${randomBytes(12).toString("base64url")}`, email_confirm: true });
  if (error || !data.user) throw new Error("AUTH_CREATE_FAILED");
  createdAuthIds.push(data.user.id);
  return data.user.id;
}

async function createFixture(suffix: "a" | "b") {
  const roles = await roleIds();
  const slug = `${fixtureKey}-${suffix}`;
  const real = suffix === "a";
  const company = await prisma.company.create({
    data: { name: `DATA-02 effacement ${suffix.toUpperCase()}`, slug, isDemo: false, status: "ACTIVE", email: `contact@${slug}.invalid`, phone: "06 12 34 56 78", legalName: `DATA-02 ${suffix} SAS`, billingAddress: "1 rue de Test", billingPostalCode: "75001", billingCity: "Paris" },
  });
  const mk = async (role: keyof typeof roles, label: string) => {
    const email = `${label}-${slug}@example.invalid`;
    return prisma.user.create({ data: { authId: await authId(email, real), email, firstName: label, lastName: "DATA-02", status: "ACTIVE", roleId: roles[role], companyId: company.id } });
  };
  const admin = await mk("COMPANY_ADMIN", "admin");
  const client = await mk("CLIENT", "client");
  const driver = await mk("DRIVER", "driver");
  await prisma.customerAddress.create({ data: { label: "Site", address: "2 rue de Test", city: "Paris", postalCode: "75002", isDefault: true, userId: client.id } });
  await prisma.driverLocation.create({ data: { driverId: driver.id, latitude: 48.86, longitude: 2.34, accuracy: 10 } });
  const order = await prisma.order.create({
    data: {
      reference: `CMD-${suffix}-${randomUUID()}`, totalAmount: 25, itemCount: 1, notes: fixtureKey, companyId: company.id, customerId: client.id,
      customerEmail: client.email, shippingAddress: "3 rue de Test", shippingCity: "Paris", shippingPostalCode: "75003",
      items: { create: { name: "Colis", quantity: 1, unitPrice: 25 } },
    },
  });
  const delivery = await prisma.delivery.create({
    data: {
      reference: `LIV-${suffix}-${randomUUID()}`, status: "DELIVERED", address: "3 rue de Test", city: "Paris", postalCode: "75003",
      driverId: driver.id, driverName: "Livreur", companyId: company.id, orderId: order.id, customerId: client.id,
      completedAt: new Date(), podOutcome: "SUCCESS", podCapturedAt: new Date(),
      trackingEvents: { create: { label: "Livrée", description: fixtureKey } },
    },
  });
  const proofPath = await uploadPodPhoto({ companyId: company.id, deliveryId: delivery.id, bytes: png, contentType: "image/png" });
  await prisma.delivery.update({ where: { id: delivery.id }, data: { podPhotoPath: proofPath } });
  const logoPath = real ? await uploadCompanyLogo(company.id, png) : null;
  if (logoPath) await prisma.company.update({ where: { id: company.id }, data: { logoUrl: logoPath } });
  const message = await prisma.orderMessage.create({
    data: { orderId: order.id, authorId: admin.id, authorName: "Admin", authorRole: "COMPANY_ADMIN", body: fixtureKey, kind: "INSTRUCTION", requestKey: `${fixtureKey}-${suffix}` },
  });
  const invoice = await prisma.invoice.create({
    data: { reference: `FAC-${suffix}-${randomUUID()}`, amount: 25, lineItems: [{ label: "Livraison", amount: 25, quantity: 1 }], companyId: company.id, orderId: order.id, customerId: client.id },
  });
  await Promise.all([
    prisma.clientNotification.create({ data: { type: "ORDER_MESSAGE", title: "DATA-02", body: fixtureKey, href: `/portal/orders/${order.id}`, orderMessageId: message.id, userId: client.id } }),
    prisma.supportTicket.create({ data: { subject: "DATA-02", message: fixtureKey, companyId: company.id, customerId: client.id, relatedOrderId: order.id, messages: { create: { body: fixtureKey, isStaff: false, authorId: client.id } } } }),
    prisma.operationJob.create({ data: { jobKey: `${fixtureKey}-${suffix}`, type: "CLIENT_NOTIFICATION", status: "SUCCEEDED", payload: { fixture: true }, completedAt: new Date(), companyId: company.id } }),
  ]);
  return { company, admin, client, driver, invoice, proofPath, logoPath };
}

async function counts(companyId: string) {
  const users = await prisma.user.findMany({ where: { companyId }, select: { id: true } });
  const userIds = { in: users.map((user) => user.id) };
  const [orders, deliveries, invoices, tickets, jobs, locations, addresses, messages] = await Promise.all([
    prisma.order.count({ where: { companyId } }),
    prisma.delivery.count({ where: { companyId } }),
    prisma.invoice.count({ where: { companyId } }),
    prisma.supportTicket.count({ where: { companyId } }),
    prisma.operationJob.count({ where: { companyId } }),
    prisma.driverLocation.count({ where: { driverId: userIds } }),
    prisma.customerAddress.count({ where: { userId: userIds } }),
    prisma.orderMessage.count({ where: { order: { companyId } } }),
  ]);
  return { users: users.length, orders, deliveries, invoices, tickets, jobs, locations, addresses, messages };
}

async function folder(bucket: string, companyId: string) {
  const { data, error } = await createAdminClient().storage.from(bucket).list(companyId);
  assert.equal(error, null);
  return (data ?? []).map((row) => row.name);
}

async function cleanup() {
  const storage = createAdminClient().storage;
  const companies = await prisma.company.findMany({ where: { slug: { startsWith: fixtureKey } }, select: { id: true } });
  for (const { id } of companies) {
    for (const bucket of ["delivery-pods", "company-logos", INVOICE_ARCHIVE_BUCKET]) {
      const names = await folder(bucket, id).catch(() => [] as string[]);
      if (names.length) await storage.from(bucket).remove(names.map((name) => `${id}/${name}`));
    }
    await prisma.$transaction(async (tx) => {
      await tx.operationJob.deleteMany({ where: { companyId: id } });
      await tx.supportTicket.deleteMany({ where: { companyId: id } });
      await tx.invoice.deleteMany({ where: { companyId: id } });
      await tx.order.deleteMany({ where: { companyId: id } });
      await tx.user.deleteMany({ where: { companyId: id } });
      await tx.company.delete({ where: { id } });
    }, { maxWait: 10_000, timeout: 30_000 });
  }
  for (const id of createdAuthIds) await createAdminClient().auth.admin.deleteUser(id).catch(() => undefined);
}

async function run() {
  const evidence: Record<string, unknown> = { task: "DATA-02", step: "effacement d'une entreprise pilote", executedAt: new Date().toISOString() };
  try {
    png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#7fb3a0" } }).png().toBuffer();
    const a = await createFixture("a");
    const b = await createFixture("b");
    const beforeB = await counts(b.company.id);
    const beforeA = await counts(a.company.id);
    const now = new Date();

    // Accès non coupé : ni calendrier ni effacement.
    assert.deepEqual(await scheduleCompanyErasure(a.company.id, { exportConfirmedAt: new Date(now.getTime() - 31 * DAY) }), { ok: false, reason: "ACCESS_NOT_CUT" });
    assert.deepEqual(await eraseCompany(a.company.id), { status: "blocked", reason: "ACCESS_NOT_CUT" });

    // Rétablir l'accès annule un calendrier existant.
    assert.equal((await setPlatformCompanyAccess(a.company.id, "suspend")).ok, true);
    assert.equal((await scheduleCompanyErasure(a.company.id, { exportConfirmedAt: new Date(now.getTime() - DAY) })).ok, true);
    assert.deepEqual(await eraseCompany(a.company.id), { status: "blocked", reason: "DELAY_NOT_ELAPSED" });
    assert.equal((await setPlatformCompanyAccess(a.company.id, "restore")).ok, true);
    const restored = await prisma.company.findUniqueOrThrow({ where: { id: a.company.id } });
    assert.equal(readCompanyLifecycle(restored.settings), null);
    assert.equal((await setPlatformCompanyAccess(a.company.id, "suspend")).ok, true);
    assert.deepEqual(await eraseCompany(a.company.id), { status: "blocked", reason: "NOT_SCHEDULED" });

    // Export confirmé il y a 31 jours : simulation sans effet, puis refus sans autorisation.
    assert.equal((await scheduleCompanyErasure(a.company.id, { exportConfirmedAt: new Date(now.getTime() - 31 * DAY) })).ok, true);
    const dry = await eraseCompany(a.company.id);
    assert.deepEqual(dry, { status: "eligible", summary: { users: 3, invoicesToArchive: 1, invoicesAlreadyArchived: 0, proofObjects: 1, logoObjects: 1 } });
    assert.deepEqual(await counts(a.company.id), beforeA);
    assert.deepEqual(await eraseCompany(a.company.id, { apply: true }), { status: "blocked", reason: "EXPLICIT_ACTIVATION_REQUIRED" });

    const result = await eraseCompany(a.company.id, { apply: true, authorization: COMPANY_ERASURE_AUTHORIZATION });
    assert.equal(result.status, "erased");
    if (result.status !== "erased") throw new Error("NOT_ERASED");

    const afterA = await counts(a.company.id);
    assert.deepEqual(afterA, { users: 0, orders: 0, deliveries: 0, invoices: 1, tickets: 0, jobs: 0, locations: 0, addresses: 0, messages: 0 });
    for (const id of createdAuthIds) {
      const { data } = await createAdminClient().auth.admin.getUserById(id);
      assert.equal(data.user, null, "AUTH_ACCOUNT_REMAINS");
    }
    assert.deepEqual(await folder("delivery-pods", a.company.id), []);
    assert.deepEqual(await folder("company-logos", a.company.id), []);
    const tomb = await prisma.company.findUniqueOrThrow({ where: { id: a.company.id } });
    assert.equal(tomb.status, "INACTIVE");
    assert.equal(tomb.email, null);
    assert.equal(tomb.phone, null);
    assert.equal(tomb.logoUrl, null);
    assert.equal(tomb.legalName, "DATA-02 a SAS");
    assert.ok(readCompanyLifecycle(tomb.settings)?.erasedAt);
    const kept = await prisma.invoice.findUniqueOrThrow({ where: { id: a.invoice.id } });
    assert.equal(kept.customerId, null);
    assert.equal(kept.pdfUrl, `${a.company.id}/${a.invoice.id}.pdf`);
    const archived = await createAdminClient().storage.from(INVOICE_ARCHIVE_BUCKET).download(kept.pdfUrl!);
    assert.equal(archived.error, null);
    const bytes = Buffer.from(await archived.data!.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    const entry = result.manifest.kept.invoiceArchives[0]!;
    assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(JSON.stringify(result.manifest).includes(a.client.email), false);

    // Rejouer ne fait rien ; B est intacte, preuve comprise.
    assert.deepEqual(await eraseCompany(a.company.id, { apply: true, authorization: COMPANY_ERASURE_AUTHORIZATION }), { status: "blocked", reason: "ALREADY_ERASED" });
    assert.deepEqual(await counts(b.company.id), beforeB);
    const bProof = await createAdminClient().storage.from("delivery-pods").download(b.proofPath);
    assert.equal(bProof.error, null);
    assert.deepEqual(Buffer.from(await bProof.data!.arrayBuffer()), png);
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: b.company.id } })).status, "ACTIVE");

    Object.assign(evidence, {
      passed: true,
      guards: ["ACCESS_NOT_CUT", "DELAY_NOT_ELAPSED", "restore cancels schedule", "NOT_SCHEDULED", "EXPLICIT_ACTIVATION_REQUIRED", "ALREADY_ERASED"],
      dryRunChangedNothing: true,
      deleted: result.manifest.deleted,
      kept: { invoices: result.manifest.kept.invoices, invoiceFormat: entry.format, invoicePdfSha256Verified: true, customerUnlinked: true },
      supabaseAuthAccountsGone: createdAuthIds.length,
      storageFoldersEmpty: ["delivery-pods", "company-logos"],
      companyBUnchanged: true,
      backupDeletionTested: false,
    });
  } catch (error) {
    Object.assign(evidence, { passed: false, error: error instanceof Error ? error.message.slice(0, 300) : "UNKNOWN" });
    process.exitCode = 1;
  } finally {
    try {
      await cleanup();
      const residue = await prisma.company.count({ where: { slug: { startsWith: fixtureKey } } });
      Object.assign(evidence, { clean: residue === 0, fixtureCompaniesRemaining: residue });
      if (residue) process.exitCode = 1;
    } catch {
      Object.assign(evidence, { clean: false, cleanupFailed: true });
      process.exitCode = 1;
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await prisma.$disconnect();
  }
  console.log(JSON.stringify({ passed: evidence.passed, clean: evidence.clean, error: evidence.error }));
}

void run();
