import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma } from "../../src/services/prisma/client";
import {
  COMPANY_ERASURE_AUTHORIZATION,
  eraseCompany,
  isErasureManifest,
  replayRegisteredErasure,
  scheduleCompanyErasure,
} from "../../src/domains/data-lifecycle/company-erasure.service";

/**
 * DATA-02, outil opérateur (jamais appelé par une route ni par le cron).
 *   schedule <companyId> --export-confirmed-at <date ISO>   date l'export confirmé, effacement possible 30 jours après
 *   erase <companyId>                                       simulation : dit ce qui serait effacé, ne touche à rien
 *   erase <companyId> --apply                               efface ; exige COMPANY_ERASURE_ENABLED=pilot-company-erasure-v1
 *   replay-registry [--apply]                               après restauration d'une sauvegarde : ré-efface les entreprises du registre
 * Le manifeste (sans donnée personnelle) est écrit dans outputs/data02/erasure-<companyId>.json et dans le
 * registre versionné docs/operations/data02/registre/<companyId>.json, à committer tout de suite.
 */
const REGISTRY = resolve("docs/operations/data02/registre");

async function replayRegistry(apply: boolean) {
  if (apply && process.env.COMPANY_ERASURE_ENABLED !== COMPANY_ERASURE_AUTHORIZATION) throw new Error("EXPLICIT_ACTIVATION_REQUIRED");
  const files = (await readdir(REGISTRY).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).sort();
  let failures = 0;
  for (const name of files) {
    const manifest = JSON.parse(await readFile(join(REGISTRY, name), "utf8")) as unknown;
    if (!isErasureManifest(manifest) || `${manifest.companyId}.json` !== name) {
      console.log(JSON.stringify({ file: name, status: "blocked", reason: "INVALID_REGISTRY_ENTRY" }));
      failures++;
      continue;
    }
    const result = await replayRegisteredErasure(manifest, { apply, authorization: process.env.COMPANY_ERASURE_ENABLED });
    if (result.status === "blocked" || result.status === "missing") failures++;
    console.log(JSON.stringify({ companyId: manifest.companyId, ...(result.status === "erased" ? { status: "erased", deleted: result.manifest.deleted } : result) }));
  }
  console.log(JSON.stringify({ registryEntries: files.length, failures, mode: apply ? "apply" : "simulation" }));
  if (failures) process.exitCode = 2;
}

async function main() {
  const [command, companyId, ...rest] = process.argv.slice(2);
  if (command === "replay-registry") {
    const args = process.argv.slice(3);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) throw new Error("INVALID_ARGUMENTS");
    return replayRegistry(args[0] === "--apply");
  }
  if (!companyId || !/^[A-Za-z0-9_-]+$/.test(companyId)) throw new Error("INVALID_ARGUMENTS");
  if (command === "schedule") {
    if (rest.length !== 2 || rest[0] !== "--export-confirmed-at") throw new Error("INVALID_ARGUMENTS");
    const result = await scheduleCompanyErasure(companyId, { exportConfirmedAt: new Date(rest[1] ?? "") });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (command !== "erase" || rest.some((arg) => arg !== "--apply") || rest.length > 1) throw new Error("INVALID_ARGUMENTS");
  const apply = rest.includes("--apply");
  if (apply && process.env.COMPANY_ERASURE_ENABLED !== COMPANY_ERASURE_AUTHORIZATION) throw new Error("EXPLICIT_ACTIVATION_REQUIRED");
  const result = await eraseCompany(companyId, { apply, authorization: process.env.COMPANY_ERASURE_ENABLED });
  if (result.status === "erased") {
    const content = `${JSON.stringify(result.manifest, null, 2)}\n`;
    await mkdir(resolve("outputs/data02"), { recursive: true });
    await writeFile(resolve(`outputs/data02/erasure-${companyId}.json`), content, "utf8");
    await mkdir(REGISTRY, { recursive: true });
    // « wx » : une entrée du registre n'est jamais réécrite.
    await writeFile(join(REGISTRY, `${companyId}.json`), content, { encoding: "utf8", flag: "wx" })
      .then(() => console.error(`Registre : committer docs/operations/data02/registre/${companyId}.json sur preproduction.`))
      .catch(() => console.error("REGISTRY_ENTRY_ALREADY_PRESENT"));
  }
  console.log(JSON.stringify(result.status === "erased" ? { status: "erased", deleted: result.manifest.deleted, keptInvoices: result.manifest.kept.invoices } : result));
  if (result.status === "blocked" || result.status === "missing") process.exitCode = 2;
}
main()
  .catch((error) => { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "COMPANY_ERASURE_FAILED"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
