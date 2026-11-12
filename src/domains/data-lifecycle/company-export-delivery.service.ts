import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/services/prisma/client";
import { createAdminClient } from "@/services/supabase/admin";
import { writeZip, type ZipEntry } from "@/lib/zip/zip-writer";
import { COMPANY_LIFECYCLE_SETTINGS_KEY } from "@/domains/data-lifecycle/company-lifecycle-key";

/**
 * DATA-02 — remise de l'export d'une entreprise pilote (décision du propriétaire du 12 novembre 2026) :
 * un lien `/export/<jeton>` envoyé par e-mail et un code de 8 caractères donné à part (SMS ou
 * téléphone). Valable 7 jours, 5 codes faux au plus, chaque ouverture notée (date seule).
 *
 * L'export (`company-archive.service.ts`) est mis en .zip ordinaires (volumes de 45 Mo au plus :
 * limite de fichier du plan Supabase gratuit) dans le bucket privé `company-exports`. Seuls les
 * empreintes du jeton et du code sont gardées (`Company.settings.dataExportDelivery`) ; le code ne
 * s'affiche qu'une fois, dans le terminal de l'opérateur. Les fichiers sont effacés par le cron dès que
 * le lien est expiré, bloqué ou retiré, et au plus tard par l'effacement de l'entreprise.
 */

export const EXPORT_DELIVERY_SETTINGS_KEY = "dataExportDelivery";
export const EXPORT_BUCKET = "company-exports";
export const EXPORT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EXPORT_MAX_FAILED_ATTEMPTS = 5;
export const EXPORT_SIGNED_URL_SECONDS = 10 * 60;
export const EXPORT_VOLUME_MAX_BYTES = 45 * 1024 * 1024;
const MAX_LOGGED_ACCESSES = 100;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I/L : se dicte au téléphone.
const CODE_LENGTH = 8;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export interface ExportDeliveryPart { name: string; path: string; bytes: number; sha256: string }

export interface ExportDelivery {
  id: string;
  createdAt: string;
  expiresAt: string;
  tokenHash: string;
  codeSalt: string;
  codeHash: string;
  failedAttempts: number;
  lockedAt?: string;
  revokedAt?: string;
  purgedAt?: string;
  parts: ExportDeliveryPart[];
  /** Ouvertures réussies : date seule, ni adresse IP ni navigateur. */
  accesses: { at: string }[];
}

export type ExportCodeCheck =
  | { kind: "ok" }
  | { kind: "unavailable" }
  | { kind: "locked" }
  | { kind: "wrong"; remaining: number };

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

export function generateExportSecrets(): { token: string; code: string } {
  const token = randomBytes(32).toString("base64url");
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return { token, code };
}

/** « abcd efgh », « ABCD-EFGH » → « ABCDEFGH » ; null si ce n'est pas un code possible. */
export function normalizeExportCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === CODE_LENGTH && [...code].every((char) => CODE_ALPHABET.includes(char)) ? code : null;
}

export const formatExportCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
export const isExportToken = (token: unknown): token is string => typeof token === "string" && TOKEN_PATTERN.test(token);
export const hashExportToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const hashExportCode = (code: string, salt: string) => scryptSync(code, salt, 32).toString("hex");

export function readExportDelivery(settings: Prisma.JsonValue | null | undefined): ExportDelivery | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const raw = (settings as Record<string, unknown>)[EXPORT_DELIVERY_SETTINGS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.tokenHash !== "string" || typeof value.codeHash !== "string" ||
    typeof value.codeSalt !== "string" || typeof value.expiresAt !== "string" || !Array.isArray(value.parts)) return null;
  return { failedAttempts: 0, accesses: [], ...value } as unknown as ExportDelivery;
}

/** Le lien n'ouvre plus rien : retiré, effacé, expiré ou bloqué. Ses fichiers peuvent partir. */
export function isExportDeliveryClosed(delivery: ExportDelivery, now: Date): boolean {
  return Boolean(delivery.revokedAt || delivery.purgedAt || delivery.lockedAt) || Date.parse(delivery.expiresAt) <= now.getTime();
}

export function checkExportCode(delivery: ExportDelivery, code: string | null, now: Date): ExportCodeCheck {
  if (delivery.revokedAt || delivery.purgedAt || Date.parse(delivery.expiresAt) <= now.getTime()) return { kind: "unavailable" };
  if (delivery.lockedAt || delivery.failedAttempts >= EXPORT_MAX_FAILED_ATTEMPTS) return { kind: "locked" };
  const expected = Buffer.from(delivery.codeHash, "hex");
  const given = code ? Buffer.from(hashExportCode(code, delivery.codeSalt), "hex") : Buffer.alloc(expected.length);
  if (code && given.length === expected.length && timingSafeEqual(given, expected)) return { kind: "ok" };
  return { kind: "wrong", remaining: Math.max(0, EXPORT_MAX_FAILED_ATTEMPTS - delivery.failedAttempts - 1) };
}

/**
 * Répartit les fichiers en volumes. Les fichiers de tête (lisez-moi, données, manifeste) vont dans le
 * premier ; les preuves suivent, dans l'ordre. Majoration prudente pour la compression et les en-têtes.
 */
export function planExportVolumes(files: { name: string; bytes: number }[], maxBytes = EXPORT_VOLUME_MAX_BYTES): string[][] {
  const bound = (file: { name: string; bytes: number }) => file.bytes + Math.ceil(file.bytes / 1000) + 2 * file.name.length + 200;
  const volumes: string[][] = [];
  let current: string[] = [];
  let size = 22;
  for (const file of files) {
    const need = bound(file);
    if (need + 22 > maxBytes) throw new Error("EXPORT_FILE_TOO_LARGE");
    if (current.length > 0 && size + need > maxBytes) {
      volumes.push(current);
      current = [];
      size = 22;
    }
    current.push(file.name);
    size += need;
  }
  if (current.length) volumes.push(current);
  return volumes;
}

export function exportPartFileName(index: number, total: number) {
  return total === 1 ? "tutelliv-export.zip" : `tutelliv-export-partie-${index + 1}-sur-${total}.zip`;
}

function readMe(createdAt: Date, total: number) {
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(createdAt);
  return [
    "Export de vos données TutelLiv",
    `Préparé le ${date}.`,
    "",
    total > 1 ? `L'export est en ${total} fichiers .zip : ouvrez-les tous dans le même dossier.` : "L'export tient dans ce seul fichier .zip.",
    "",
    "Contenu :",
    "- company.json : toutes vos données (entreprise, comptes, clients, commandes, livraisons, suivis,",
    "  messages, factures, demandes d'aide), au format JSON lisible par tout logiciel ou développeur.",
    "- proofs/ : photos et signatures des preuves de livraison. Le fichier manifest.json indique,",
    "  pour chaque fichier, la livraison concernée (deliveryId) et son empreinte SHA-256.",
    "- manifest.json : liste complète des fichiers et empreintes, pour vérifier que rien ne manque.",
    "",
    "Ces fichiers contiennent des données personnelles : gardez-les en lieu sûr.",
    "Une question : orso@tutelliv.fr",
    "",
  ].join("\r\n");
}

// ---------------------------------------------------------------------------
// Opérations (base et stockage)
// ---------------------------------------------------------------------------

function settingsObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, Prisma.JsonValue>) } : {};
}

/** Écrit la remise si les réglages n'ont pas changé depuis leur lecture (sinon `false`). */
async function writeDelivery(companyId: string, previous: Prisma.JsonValue | null, delivery: ExportDelivery) {
  const settings = settingsObject(previous);
  settings[EXPORT_DELIVERY_SETTINGS_KEY] = delivery as unknown as Prisma.JsonValue;
  const expected = previous === null ? Prisma.DbNull : (previous as Prisma.InputJsonValue);
  const written = await prisma.company.updateMany({
    where: { id: companyId, settings: { equals: expected } },
    data: { settings: settings as Prisma.InputJsonValue },
  });
  return written.count === 1;
}

let bucketReady: Promise<void> | null = null;
async function ensureExportBucket() {
  bucketReady ??= (async () => {
    const storage = createAdminClient().storage;
    const { data, error } = await storage.listBuckets();
    if (error) throw new Error("EXPORT_STORAGE_UNAVAILABLE");
    const bucket = data?.find((item) => item.name === EXPORT_BUCKET);
    if (bucket) {
      if (bucket.public) throw new Error("EXPORT_BUCKET_PUBLIC");
      return;
    }
    const created = await storage.createBucket(EXPORT_BUCKET, {
      public: false, fileSizeLimit: 50 * 1024 * 1024, allowedMimeTypes: ["application/zip"],
    });
    if (created.error) throw new Error("EXPORT_STORAGE_UNAVAILABLE");
  })().catch((error) => { bucketReady = null; throw error; });
  await bucketReady;
}

async function removeExportObjects(paths: string[]) {
  if (!paths.length) return;
  const { error } = await createAdminClient().storage.from(EXPORT_BUCKET).remove(paths);
  if (error && !/not found/i.test(error.message)) throw new Error("EXPORT_STORAGE_UNAVAILABLE");
}

interface ArchiveManifest { schema: string; companyId: string; complete: boolean; entries: { path: string; bytes: number }[] }

/**
 * Prépare la remise d'une archive déjà produite et vérifiée (`export-archive.ts`, `verify-archive.mjs`).
 * L'accès doit être coupé (données figées). Rend le lien et le code, une seule fois.
 */
export async function prepareCompanyExportDelivery(companyId: string, archiveDir: string, now = new Date()):
  Promise<{ ok: true; token: string; code: string; expiresAt: string; parts: ExportDeliveryPart[] } | { ok: false; reason: string }> {
  if (!SAFE_ID.test(companyId)) return { ok: false, reason: "INVALID_ID" };
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { isDemo: true, status: true, settings: true } });
  if (!company) return { ok: false, reason: "MISSING" };
  if (company.isDemo) return { ok: false, reason: "DEMO_COMPANY" };
  const lifecycle = settingsObject(company.settings)[COMPANY_LIFECYCLE_SETTINGS_KEY] as Record<string, unknown> | undefined;
  if (lifecycle?.erasedAt) return { ok: false, reason: "ALREADY_ERASED" };
  if (company.status !== "SUSPENDED") return { ok: false, reason: "ACCESS_NOT_CUT" };
  const existing = readExportDelivery(company.settings);
  if (existing && !existing.purgedAt) return { ok: false, reason: "DELIVERY_EXISTS" };

  const manifest = JSON.parse(await readFile(join(archiveDir, "manifest.json"), "utf8")) as ArchiveManifest;
  if (manifest.schema !== "tutelliv-company-archive" || manifest.complete !== true || manifest.companyId !== companyId) {
    return { ok: false, reason: "ARCHIVE_MISMATCH" };
  }
  const readme = Buffer.from(readMe(now, 1), "utf8");
  const manifestBytes = (await lstat(join(archiveDir, "manifest.json"))).size;
  const files = [
    { name: "LISEZMOI.txt", bytes: readme.length + 200 },
    ...manifest.entries.filter((entry) => entry.path === "company.json"),
    { name: "manifest.json", bytes: manifestBytes },
    ...manifest.entries.filter((entry) => entry.path !== "company.json"),
  ].map((file) => ({ name: "name" in file ? file.name : file.path, bytes: file.bytes }));
  const volumes = planExportVolumes(files);

  const id = randomUUID();
  const work = await mkdtemp(join(tmpdir(), "tutelliv-export-"));
  const parts: ExportDeliveryPart[] = [];
  try {
    await ensureExportBucket();
    for (const [index, names] of volumes.entries()) {
      const entries: ZipEntry[] = names.map((name) => name === "LISEZMOI.txt"
        ? { name, source: { bytes: Buffer.from(readMe(now, volumes.length), "utf8") } }
        : { name, source: { path: join(archiveDir, name) } });
      const name = exportPartFileName(index, volumes.length);
      const local = join(work, name);
      const zip = await writeZip(local, entries, now);
      const path = `${companyId}/${id}-${index + 1}.zip`;
      const { error } = await createAdminClient().storage.from(EXPORT_BUCKET)
        .upload(path, await readFile(local), { contentType: "application/zip", upsert: false });
      if (error) throw new Error("EXPORT_UPLOAD_FAILED");
      parts.push({ name, path, bytes: zip.bytes, sha256: zip.sha256 });
    }
    const { token, code } = generateExportSecrets();
    const codeSalt = randomBytes(16).toString("hex");
    const delivery: ExportDelivery = {
      id, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + EXPORT_LINK_TTL_MS).toISOString(),
      tokenHash: hashExportToken(token), codeSalt, codeHash: hashExportCode(code, codeSalt),
      failedAttempts: 0, parts, accesses: [],
    };
    if (!(await writeDelivery(companyId, company.settings, delivery))) throw new Error("CONCURRENT_CHANGE");
    return { ok: true, token, code, expiresAt: delivery.expiresAt, parts };
  } catch (error) {
    await removeExportObjects(parts.map((part) => part.path)).catch(() => undefined);
    if (error instanceof Error && /^[A-Z_]+$/.test(error.message)) return { ok: false, reason: error.message };
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export type ExportOpenResult =
  | { status: "ok"; expiresAt: string; parts: { name: string; bytes: number; url: string }[] }
  | { status: "unavailable" }
  | { status: "locked" }
  | { status: "wrong"; remaining: number };

/** Page publique : vérifie le code, note l'ouverture et rend des liens de téléchargement de 10 minutes. */
export async function openCompanyExport(token: unknown, rawCode: unknown, now = new Date()): Promise<ExportOpenResult> {
  if (!isExportToken(token)) return { status: "unavailable" };
  const tokenHash = hashExportToken(token);
  const code = normalizeExportCode(rawCode);
  for (let attempt = 0; attempt < 3; attempt++) {
    const company = await prisma.company.findFirst({
      where: { settings: { path: [EXPORT_DELIVERY_SETTINGS_KEY, "tokenHash"], equals: tokenHash } },
      select: { id: true, settings: true },
    });
    const delivery = company && readExportDelivery(company.settings);
    if (!company || !delivery || delivery.tokenHash !== tokenHash) return { status: "unavailable" };
    const check = checkExportCode(delivery, code, now);
    if (check.kind === "unavailable" || check.kind === "locked") return { status: check.kind };
    if (check.kind === "wrong") {
      const failedAttempts = delivery.failedAttempts + 1;
      const next = { ...delivery, failedAttempts, ...(failedAttempts >= EXPORT_MAX_FAILED_ATTEMPTS ? { lockedAt: now.toISOString() } : {}) };
      if (!(await writeDelivery(company.id, company.settings, next))) continue;
      return check.remaining === 0 ? { status: "locked" } : { status: "wrong", remaining: check.remaining };
    }
    const next = { ...delivery, accesses: [...delivery.accesses, { at: now.toISOString() }].slice(-MAX_LOGGED_ACCESSES) };
    if (!(await writeDelivery(company.id, company.settings, next))) continue;
    const storage = createAdminClient().storage.from(EXPORT_BUCKET);
    const parts = [];
    for (const part of delivery.parts) {
      const { data, error } = await storage.createSignedUrl(part.path, EXPORT_SIGNED_URL_SECONDS, { download: part.name });
      if (error || !data?.signedUrl) throw new Error("EXPORT_STORAGE_UNAVAILABLE");
      parts.push({ name: part.name, bytes: part.bytes, url: data.signedUrl });
    }
    return { status: "ok", expiresAt: delivery.expiresAt, parts };
  }
  throw new Error("EXPORT_CONCURRENT_CHANGE");
}

/** État pour l'opérateur, sans jeton ni code. */
export async function getCompanyExportDelivery(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
  const delivery = company && readExportDelivery(company.settings);
  if (!delivery) return null;
  return {
    id: delivery.id, createdAt: delivery.createdAt, expiresAt: delivery.expiresAt, failedAttempts: delivery.failedAttempts,
    lockedAt: delivery.lockedAt, revokedAt: delivery.revokedAt, purgedAt: delivery.purgedAt,
    parts: delivery.parts.map(({ name, bytes }) => ({ name, bytes })), accesses: delivery.accesses,
  };
}

/** Ferme la remise et efface ses fichiers (retrait par l'opérateur, ou expiration via le cron). */
async function closeDelivery(companyId: string, now: Date, revoke: boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
    const delivery = company && readExportDelivery(company.settings);
    if (!company || !delivery || delivery.purgedAt) return false;
    await removeExportObjects(delivery.parts.map((part) => part.path));
    const stamp = now.toISOString();
    const next: ExportDelivery = { ...delivery, purgedAt: stamp, ...(revoke && !delivery.revokedAt ? { revokedAt: stamp } : {}) };
    if (await writeDelivery(companyId, company.settings, next)) return true;
  }
  throw new Error("EXPORT_CONCURRENT_CHANGE");
}

export const revokeCompanyExportDelivery = (companyId: string, now = new Date()) => closeDelivery(companyId, now, true);

/** Cron : efface les fichiers des remises expirées, bloquées ou retirées. Rend le nombre traité. */
export async function purgeClosedExportDeliveries(now = new Date()): Promise<number> {
  const companies = await prisma.company.findMany({
    // Peu d'entreprises hors démo : tri en mémoire plutôt qu'un filtre JSON.
    where: { isDemo: false },
    select: { id: true, settings: true },
  });
  let purged = 0;
  for (const company of companies) {
    const delivery = readExportDelivery(company.settings);
    if (delivery && !delivery.purgedAt && isExportDeliveryClosed(delivery, now) && (await closeDelivery(company.id, now, false))) purged++;
  }
  return purged;
}
