import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { once } from "node:events";
import { open, rm } from "node:fs/promises";
import { createDeflateRaw } from "node:zlib";

/**
 * DATA-02 — écriture d'un .zip ordinaire (deflate, noms UTF-8), en flux et sans dépendance, pour la
 * remise de l'export d'une entreprise. Un .zip qui s'ouvre d'un double clic sur Mac et Windows.
 * Pas de ZIP64 : chaque volume reste sous 4 Gio et 65 535 fichiers (refus sinon).
 */

export interface ZipEntry {
  /** Chemin dans l'archive, séparateur « / », sans « .. » ni chemin absolu. */
  name: string;
  /** Fichier local à lire en flux, ou contenu en mémoire (petits fichiers texte). */
  source: { path: string } | { bytes: Uint8Array };
}

export interface ZipResult {
  bytes: number;
  sha256: string;
  entries: number;
}

const MAX_32 = 0xffff_ffff;
const FLAGS = 0x0808; // bit 3 : tailles dans le descripteur suivant les données ; bit 11 : noms UTF-8.
const DEFLATE = 8;
const VERSION = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isSafeZipName(name: string): boolean {
  if (!name || name.length > 255 || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Écrit `entries` dans `outPath` (créé en 0600, refusé s'il existe) et rend taille et SHA-256 du fichier. */
export async function writeZip(outPath: string, entries: ZipEntry[], modifiedAt = new Date()): Promise<ZipResult> {
  if (entries.length === 0 || entries.length > 0xffff) throw new Error("ZIP_ENTRY_COUNT");
  const names = new Set<string>();
  for (const entry of entries) {
    if (!isSafeZipName(entry.name) || names.has(entry.name)) throw new Error("ZIP_INVALID_NAME");
    names.add(entry.name);
  }
  const stamp = dosDateTime(modifiedAt);
  // « wx » : un fichier déjà présent fait échouer ici, avant toute écriture, et n'est jamais supprimé.
  const handle = await open(outPath, "wx", 0o600);
  const out = handle.createWriteStream();
  let failure: Error | null = null;
  out.on("error", (error) => { failure = error; });
  const hash = createHash("sha256");
  let offset = 0;
  const write = async (chunk: Uint8Array) => {
    offset += chunk.length;
    if (offset > MAX_32) throw new Error("ZIP_TOO_LARGE");
    if (failure) throw failure;
    hash.update(chunk);
    if (!out.write(chunk)) await once(out, "drain");
  };
  const central: Buffer[] = [];
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name, "utf8");
      const headerOffset = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(VERSION, 4);
      local.writeUInt16LE(FLAGS, 6);
      local.writeUInt16LE(DEFLATE, 8);
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      // CRC et tailles à zéro : ils suivent les données (descripteur), comme tout zip écrit en flux.
      local.writeUInt16LE(name.length, 26);
      await write(local);
      await write(name);

      let crc = 0;
      let size = 0;
      let compressed = 0;
      const deflate = createDeflateRaw({ level: 6 });
      const drained = (async () => {
        for await (const chunk of deflate) {
          compressed += (chunk as Buffer).length;
          await write(chunk as Buffer);
        }
      })().catch((error: unknown) => {
        // Une écriture refusée arrête aussi la compression (sinon l'alimentation attendrait sans fin).
        deflate.destroy(error instanceof Error ? error : new Error("ZIP_WRITE_FAILED"));
        throw error;
      });
      const feed = async (chunk: Uint8Array) => {
        crc = crc32(chunk, crc);
        size += chunk.length;
        if (size > MAX_32) throw new Error("ZIP_TOO_LARGE");
        if (!deflate.write(chunk)) await once(deflate, "drain");
      };
      try {
        if ("bytes" in entry.source) await feed(entry.source.bytes);
        else for await (const chunk of createReadStream(entry.source.path)) await feed(chunk as Buffer);
        deflate.end();
      } catch (error) {
        deflate.destroy();
        await drained.catch(() => undefined);
        throw error;
      }
      await drained;

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed, 8);
      descriptor.writeUInt32LE(size, 12);
      await write(descriptor);

      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(VERSION, 4);
      record.writeUInt16LE(VERSION, 6);
      record.writeUInt16LE(FLAGS, 8);
      record.writeUInt16LE(DEFLATE, 10);
      record.writeUInt16LE(stamp.time, 12);
      record.writeUInt16LE(stamp.date, 14);
      record.writeUInt32LE(crc, 16);
      record.writeUInt32LE(compressed, 20);
      record.writeUInt32LE(size, 24);
      record.writeUInt16LE(name.length, 28);
      record.writeUInt32LE(headerOffset, 42);
      central.push(record, name);
    }
    const centralOffset = offset;
    for (const part of central) await write(part);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - centralOffset, 12);
    end.writeUInt32LE(centralOffset, 16);
    await write(end);
    out.end();
    await once(out, "finish");
  } catch (error) {
    out.destroy();
    await rm(outPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { bytes: offset, sha256: hash.digest("hex"), entries: entries.length };
}
