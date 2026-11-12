import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { crc32, isSafeZipName, writeZip } from "../src/lib/zip/zip-writer";
import {
  EXPORT_MAX_FAILED_ATTEMPTS,
  checkExportCode,
  exportPartFileName,
  generateExportSecrets,
  hashExportCode,
  hashExportToken,
  isExportDeliveryClosed,
  isExportToken,
  normalizeExportCode,
  planExportVolumes,
  readExportDelivery,
  type ExportDelivery,
} from "../src/domains/data-lifecycle/company-export-delivery.service";

/** Relit un zip par son répertoire central, comme un logiciel de décompression. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const content = inflateRawSync(zip.subarray(dataStart, dataStart + compressed));
    assert.equal(content.length, size);
    assert.equal(crc32(content), crc);
    files.set(name, content);
    at += 46 + nameLength;
  }
  return files;
}

test("zip : contenu, noms accentués et fichiers lus en flux relus à l'identique", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zip-test-"));
  try {
    const photo = Buffer.alloc(300_000);
    for (let i = 0; i < photo.length; i++) photo[i] = (i * 7919) % 251;
    await writeFile(join(dir, "photo.jpg"), photo);
    const text = Buffer.from("Données de l'entreprise éàç\n".repeat(500), "utf8");
    const result = await writeZip(join(dir, "a.zip"), [
      { name: "LISEZMOI.txt", source: { bytes: text } },
      { name: "proofs/000001.jpg", source: { path: join(dir, "photo.jpg") } },
    ]);
    const zip = await readFile(join(dir, "a.zip"));
    assert.equal(result.bytes, zip.length);
    assert.equal(result.entries, 2);
    const files = readZip(zip);
    assert.deepEqual([...files.keys()], ["LISEZMOI.txt", "proofs/000001.jpg"]);
    assert.ok(files.get("LISEZMOI.txt")!.equals(text));
    assert.ok(files.get("proofs/000001.jpg")!.equals(photo));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("zip : noms dangereux refusés, fichier existant jamais écrasé ni supprimé", async () => {
  for (const name of ["../x", "/etc/x", "a//b", "a\\b", "", "./a"]) assert.equal(isSafeZipName(name), false, name);
  assert.equal(isSafeZipName("proofs/000001.jpg"), true);
  const dir = await mkdtemp(join(tmpdir(), "zip-test-"));
  try {
    await assert.rejects(writeZip(join(dir, "b.zip"), [{ name: "../b", source: { bytes: Buffer.from("x") } }]), /ZIP_INVALID_NAME/);
    await writeFile(join(dir, "c.zip"), "à garder");
    await assert.rejects(writeZip(join(dir, "c.zip"), [{ name: "a", source: { bytes: Buffer.from("x") } }]));
    assert.equal(await readFile(join(dir, "c.zip"), "utf8"), "à garder");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("secrets : jeton long, code de 8 caractères dictable, saisie tolérante", () => {
  const { token, code } = generateExportSecrets();
  assert.ok(isExportToken(token));
  assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.equal(normalizeExportCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `), code);
  assert.equal(normalizeExportCode("ABCD-EFG0"), null); // 0 n'existe pas dans l'alphabet
  assert.equal(normalizeExportCode("ABC"), null);
  assert.equal(normalizeExportCode(42), null);
  assert.equal(isExportToken("../../etc"), false);
  assert.notEqual(hashExportToken(token), token);
});

function delivery(overrides: Partial<ExportDelivery> = {}): ExportDelivery {
  const codeSalt = "00112233445566778899aabbccddeeff";
  return {
    id: "d1", createdAt: "2026-11-12T10:00:00.000Z", expiresAt: "2026-11-19T10:00:00.000Z",
    tokenHash: hashExportToken("t"), codeSalt, codeHash: hashExportCode("ABCDEFGH", codeSalt),
    failedAttempts: 0, parts: [{ name: "tutelliv-export.zip", path: "co/d1-1.zip", bytes: 10, sha256: "a" }], accesses: [],
    ...overrides,
  };
}
const NOW = new Date("2026-11-13T10:00:00.000Z");

test("code : bon code accepté, faux code décompté jusqu'au blocage, lien expiré ou retiré refusé", () => {
  assert.deepEqual(checkExportCode(delivery(), "ABCDEFGH", NOW), { kind: "ok" });
  assert.deepEqual(checkExportCode(delivery(), "ABCDEFGJ", NOW), { kind: "wrong", remaining: EXPORT_MAX_FAILED_ATTEMPTS - 1 });
  assert.deepEqual(checkExportCode(delivery({ failedAttempts: EXPORT_MAX_FAILED_ATTEMPTS - 1 }), "ABCDEFGJ", NOW), { kind: "wrong", remaining: 0 });
  assert.deepEqual(checkExportCode(delivery(), null, NOW), { kind: "wrong", remaining: EXPORT_MAX_FAILED_ATTEMPTS - 1 });
  // Bloqué : même le bon code ne passe plus.
  assert.deepEqual(checkExportCode(delivery({ failedAttempts: EXPORT_MAX_FAILED_ATTEMPTS }), "ABCDEFGH", NOW), { kind: "locked" });
  assert.deepEqual(checkExportCode(delivery({ lockedAt: NOW.toISOString() }), "ABCDEFGH", NOW), { kind: "locked" });
  assert.deepEqual(checkExportCode(delivery(), "ABCDEFGH", new Date("2026-11-19T10:00:00.000Z")), { kind: "unavailable" });
  assert.deepEqual(checkExportCode(delivery({ revokedAt: NOW.toISOString() }), "ABCDEFGH", NOW), { kind: "unavailable" });
  assert.deepEqual(checkExportCode(delivery({ purgedAt: NOW.toISOString() }), "ABCDEFGH", NOW), { kind: "unavailable" });
});

test("fermeture : expiré, bloqué ou retiré → fichiers à effacer ; lecture des réglages robuste", () => {
  assert.equal(isExportDeliveryClosed(delivery(), NOW), false);
  assert.equal(isExportDeliveryClosed(delivery({ lockedAt: NOW.toISOString() }), NOW), true);
  assert.equal(isExportDeliveryClosed(delivery(), new Date("2026-11-20T00:00:00.000Z")), true);
  assert.equal(readExportDelivery({ dataExportDelivery: delivery() } as unknown as Parameters<typeof readExportDelivery>[0])?.id, "d1");
  assert.equal(readExportDelivery({ dataExportDelivery: { id: "x" } }), null);
  assert.equal(readExportDelivery(null), null);
});

test("volumes : fichiers de tête dans le premier, preuves réparties, fichier trop gros refusé", () => {
  const MB = 1024 * 1024;
  const files = [
    { name: "LISEZMOI.txt", bytes: 1_000 }, { name: "company.json", bytes: 2 * MB }, { name: "manifest.json", bytes: 10_000 },
    ...Array.from({ length: 30 }, (_, i) => ({ name: `proofs/${String(i + 1).padStart(6, "0")}.jpg`, bytes: 3 * MB })),
  ];
  const volumes = planExportVolumes(files, 45 * MB);
  assert.deepEqual(volumes[0]!.slice(0, 3), ["LISEZMOI.txt", "company.json", "manifest.json"]);
  assert.equal(volumes.flat().length, files.length);
  assert.equal(volumes.length, 3);
  assert.deepEqual(planExportVolumes(files.slice(0, 3), 45 * MB).length, 1);
  assert.throws(() => planExportVolumes([{ name: "company.json", bytes: 46 * MB }], 45 * MB), /EXPORT_FILE_TOO_LARGE/);
  assert.equal(exportPartFileName(0, 1), "tutelliv-export.zip");
  assert.equal(exportPartFileName(1, 3), "tutelliv-export-partie-2-sur-3.zip");
});
