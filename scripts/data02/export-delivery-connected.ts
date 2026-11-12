import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/services/prisma/client";
import { createAdminClient } from "../../src/services/supabase/admin";
import { uploadPodPhoto } from "../../src/lib/storage/pod";
import { exportCompanyArchive } from "../../src/domains/data-lifecycle/company-archive.service";
import {
  EXPORT_BUCKET,
  EXPORT_MAX_FAILED_ATTEMPTS,
  formatExportCode,
  getCompanyExportDelivery,
  openCompanyExport,
  prepareCompanyExportDelivery,
  purgeClosedExportDeliveries,
  revokeCompanyExportDelivery,
} from "../../src/domains/data-lifecycle/company-export-delivery.service";

/**
 * DATA-02, exercice connecté de la remise de l'export : entreprise fictive `data02-export-…` (accès
 * coupé, une livraison avec photo), archive, .zip mis en ligne dans le bucket privé, code faux puis bon,
 * téléchargement réel et relecture du .zip, retrait, blocage après 5 codes faux, purge du cron.
 *   tsx scripts/data02/export-delivery-connected.ts [preuve.json]        exercice complet, nettoyé à la fin
 *   tsx scripts/data02/export-delivery-connected.ts --keep                laisse un lien ouvert pour l'essai navigateur
 *   tsx scripts/data02/export-delivery-connected.ts --cleanup <clé>       nettoie après l'essai navigateur
 */
const DAY = 24 * 60 * 60 * 1000;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function createFixture(fixtureKey: string) {
  const role = await prisma.role.findFirstOrThrow({ where: { systemRole: "COMPANY_ADMIN" }, select: { id: true } });
  const company = await prisma.company.create({
    data: { name: "DATA-02 remise export", slug: fixtureKey, isDemo: false, status: "SUSPENDED", legalName: "DATA-02 export SAS" },
  });
  const admin = await prisma.user.create({
    data: { authId: `${fixtureKey}-${randomUUID()}`, email: `admin-${fixtureKey}@example.invalid`, firstName: "Admin", lastName: "DATA-02", status: "ACTIVE", roleId: role.id, companyId: company.id },
  });
  const order = await prisma.order.create({
    data: {
      reference: `CMD-${randomUUID()}`, totalAmount: 25, itemCount: 1, notes: fixtureKey, companyId: company.id, customerId: admin.id,
      customerEmail: admin.email, shippingAddress: "3 rue de Test", shippingCity: "Paris", shippingPostalCode: "75003",
      items: { create: { name: "Colis", quantity: 1, unitPrice: 25 } },
    },
  });
  const delivery = await prisma.delivery.create({
    data: {
      reference: `LIV-${randomUUID()}`, status: "DELIVERED", address: "3 rue de Test", city: "Paris", postalCode: "75003",
      companyId: company.id, orderId: order.id, customerId: admin.id, completedAt: new Date(), podOutcome: "SUCCESS", podCapturedAt: new Date(),
    },
  });
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#7fb3a0" } }).png().toBuffer();
  const proofPath = await uploadPodPhoto({ companyId: company.id, deliveryId: delivery.id, bytes: png, contentType: "image/png" });
  await prisma.delivery.update({ where: { id: delivery.id }, data: { podPhotoPath: proofPath } });
  return { companyId: company.id, png };
}

async function cleanup(fixtureKey: string) {
  const storage = createAdminClient().storage;
  const companies = await prisma.company.findMany({ where: { slug: { startsWith: fixtureKey } }, select: { id: true } });
  for (const { id } of companies) {
    for (const bucket of ["delivery-pods", EXPORT_BUCKET]) {
      const { data } = await storage.from(bucket).list(id);
      if (data?.length) await storage.from(bucket).remove(data.map((row) => `${id}/${row.name}`));
    }
    await prisma.$transaction(async (tx) => {
      await tx.order.deleteMany({ where: { companyId: id } });
      await tx.user.deleteMany({ where: { companyId: id } });
      await tx.company.delete({ where: { id } });
    }, { maxWait: 10_000, timeout: 30_000 });
  }
  return companies.length;
}

async function exportFolder(companyId: string) {
  const { data, error } = await createAdminClient().storage.from(EXPORT_BUCKET).list(companyId);
  assert.equal(error, null);
  return (data ?? []).map((row) => row.name);
}

async function makeArchive(companyId: string, parent: string) {
  const archive = await exportCompanyArchive(companyId, parent);
  const verified = spawnSync(process.execPath, [resolve("scripts/data02/verify-archive.mjs"), archive.path, archive.manifestSha256], { encoding: "utf8" });
  assert.equal(verified.status, 0, "ARCHIVE_VERIFICATION_FAILED");
  return archive;
}

async function run(keep: boolean) {
  const fixtureKey = `data02-export-${randomUUID()}`;
  const evidence: Record<string, unknown> = { task: "DATA-02", step: "remise de l'export (lien + code)", executedAt: new Date().toISOString() };
  const parent = await mkdtemp(join(tmpdir(), "data02-export-"));
  let cleaned = false;
  try {
    const { companyId, png } = await createFixture(fixtureKey);
    const archive = await makeArchive(companyId, parent);

    // Accès non coupé : rien n'est mis en ligne.
    await prisma.company.update({ where: { id: companyId }, data: { status: "ACTIVE" } });
    assert.deepEqual(await prepareCompanyExportDelivery(companyId, archive.path), { ok: false, reason: "ACCESS_NOT_CUT" });
    await prisma.company.update({ where: { id: companyId }, data: { status: "SUSPENDED" } });

    const prepared = await prepareCompanyExportDelivery(companyId, archive.path);
    assert.ok(prepared.ok);
    assert.deepEqual(await prepareCompanyExportDelivery(companyId, archive.path), { ok: false, reason: "DELIVERY_EXISTS" });
    assert.equal((await exportFolder(companyId)).length, prepared.parts.length);
    // Ni le jeton ni le code ne sont gardés en clair.
    const stored = JSON.stringify((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).settings);
    assert.equal(stored.includes(prepared.token) || stored.includes(prepared.code), false);

    if (keep) {
      const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
      console.log(JSON.stringify({ fixtureKey, link: `${base}/export/${prepared.token}`, code: formatExportCode(prepared.code) }));
      cleaned = true; // nettoyage par --cleanup après l'essai navigateur
      return;
    }

    const wrong = await openCompanyExport(prepared.token, "AAAA-AAAA");
    assert.deepEqual(wrong, { status: "wrong", remaining: EXPORT_MAX_FAILED_ATTEMPTS - 1 });
    assert.deepEqual(await openCompanyExport(`${prepared.token.slice(0, -1)}x`, prepared.code), { status: "unavailable" });
    const opened = await openCompanyExport(prepared.token, formatExportCode(prepared.code).toLowerCase());
    assert.equal(opened.status, "ok");
    if (opened.status !== "ok") return;

    // Téléchargement réel par le lien signé, puis relecture du .zip par unzip.
    const work = await mkdtemp(join(tmpdir(), "data02-export-dl-"));
    try {
      for (const [index, part] of opened.parts.entries()) {
        const response = await fetch(part.url);
        assert.equal(response.status, 200);
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.equal(sha256(bytes), prepared.parts[index]!.sha256);
        await writeFile(join(work, part.name), bytes);
        const tested = spawnSync("unzip", ["-t", join(work, part.name)], { encoding: "utf8" });
        assert.equal(tested.status, 0, "UNZIP_FAILED");
      }
      const unzip = spawnSync("unzip", ["-q", join(work, opened.parts[0]!.name), "-d", join(work, "out")], { encoding: "utf8" });
      assert.equal(unzip.status, 0);
      assert.ok((await readFile(join(work, "out", "company.json"))).equals(await readFile(join(archive.path, "company.json"))));
      const manifest = JSON.parse(await readFile(join(work, "out", "manifest.json"), "utf8")) as { entries: { path: string }[] };
      const proof = manifest.entries.find((entry) => entry.path.startsWith("proofs/"))!;
      assert.ok((await readFile(join(work, "out", proof.path))).equals(png));
      assert.match(await readFile(join(work, "out", "LISEZMOI.txt"), "utf8"), /company\.json/);
    } finally { await rm(work, { recursive: true, force: true }); }

    const status = await getCompanyExportDelivery(companyId);
    assert.equal(status?.failedAttempts, 1);
    assert.equal(status?.accesses.length, 1);

    // Retrait : fichiers effacés, lien refusé.
    assert.equal(await revokeCompanyExportDelivery(companyId), true);
    assert.deepEqual(await exportFolder(companyId), []);
    assert.deepEqual(await openCompanyExport(prepared.token, prepared.code), { status: "unavailable" });

    // Nouvelle remise : 5 codes faux bloquent le lien, même pour le bon code ; le cron efface ses fichiers.
    const second = await prepareCompanyExportDelivery(companyId, archive.path);
    assert.ok(second.ok);
    const answers = [];
    for (let i = 0; i < EXPORT_MAX_FAILED_ATTEMPTS; i++) answers.push((await openCompanyExport(second.token, "AAAAAAAA")).status);
    assert.deepEqual(answers, ["wrong", "wrong", "wrong", "wrong", "locked"]);
    assert.deepEqual(await openCompanyExport(second.token, second.code), { status: "locked" });
    assert.ok((await purgeClosedExportDeliveries()) >= 1);
    assert.deepEqual(await exportFolder(companyId), []);

    // Expiration : une troisième remise, encore ouverte, n'est effacée qu'après 7 jours.
    const third = await prepareCompanyExportDelivery(companyId, archive.path);
    assert.ok(third.ok);
    await purgeClosedExportDeliveries();
    assert.equal((await exportFolder(companyId)).length, third.parts.length);
    await purgeClosedExportDeliveries(new Date(Date.now() + 8 * DAY));
    assert.deepEqual(await exportFolder(companyId), []);
    assert.deepEqual(await openCompanyExport(third.token, third.code), { status: "unavailable" });

    evidence.result = {
      parts: prepared.parts.map(({ name, bytes }) => ({ name, bytes })),
      wrongCode: "refusé, 4 essais restants",
      rightCode: "liens signés, .zip téléchargé, unzip -t OK, company.json et photo identiques à l'archive",
      revoke: "fichiers effacés, lien refusé",
      lock: answers,
      cronPurge: "fichiers effacés après blocage et après 7 jours",
      secretsStored: false,
    };
  } finally {
    if (!cleaned) evidence.cleanedCompanies = await cleanup(fixtureKey);
    await rm(parent, { recursive: true, force: true });
  }
  if (!keep) {
    const outputPath = resolve(process.argv[2] ?? "outputs/data02/export-delivery-connected.json");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(evidence, null, 2));
  }
}

const args = process.argv.slice(2);
const main = args[0] === "--cleanup"
  ? (async () => {
    if (!/^data02-export-[0-9a-f-]{36}$/.test(args[1] ?? "")) throw new Error("INVALID_ARGUMENTS");
    console.log(JSON.stringify({ cleanedCompanies: await cleanup(args[1]!) }));
  })()
  : run(args[0] === "--keep");
main
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
