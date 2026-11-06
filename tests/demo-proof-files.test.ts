import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import {
  attachDemoProofFiles,
  renderDemoProofFiles,
} from "../src/domains/demo/demo-proof-files.service";
import { buildScenario, demoScenarioAnchor } from "../src/domains/demo/demo-scenario.service";
import { validatePodPhoto } from "../src/lib/storage/pod";
import { validatePodSignature } from "../src/lib/storage/pod-signature";

const fakeFiles = async () => ({ photo: Buffer.from("photo"), signature: Buffer.from("signature") });

test("DEMO-REFONTE : la photo et la signature passent les contrôles d'une vraie preuve", async () => {
  for (const variant of [0, 1, 2, 3]) {
    const { photo, signature } = await renderDemoProofFiles(variant);
    assert.doesNotThrow(() => validatePodPhoto(photo, "image/jpeg"));
    assert.doesNotThrow(() => validatePodSignature(signature, "image/png"));
    const meta = await sharp(photo).metadata();
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 900);
    assert.ok(photo.length < 300 * 1024, `photo légère (${photo.length} octets)`);
  }
});

test("DEMO-REFONTE : les 4 livrées du jour reçoivent photo et signature, le dossier est vidé avant", async () => {
  const calls: string[] = [];
  const result = await attachDemoProofFiles("company_1", ["d1", "d2", "d3", "d4"], {
    isPoolCompany: async () => true,
    purge: async (companyId) => { calls.push(`purge:${companyId}`); },
    render: async (variant) => { calls.push(`render:${variant}`); return fakeFiles(); },
    uploadPhoto: async ({ deliveryId, contentType }) => { calls.push(`photo:${deliveryId}:${contentType}`); return `company_1/${deliveryId}-1.jpg`; },
    uploadSignature: async ({ deliveryId, contentType }) => { calls.push(`sig:${deliveryId}:${contentType}`); return `company_1/${deliveryId}-sig-1.png`; },
    attach: async ({ deliveryId, photoPath, signaturePath }) => { calls.push(`attach:${deliveryId}:${photoPath}:${signaturePath}`); },
  });
  assert.deepEqual(result, { status: "attached", count: 4 });
  assert.equal(calls[0], "purge:company_1");
  for (const id of ["d1", "d2", "d3", "d4"]) {
    assert.ok(calls.includes(`photo:${id}:image/jpeg`));
    assert.ok(calls.includes(`sig:${id}:image/png`));
    assert.ok(calls.includes(`attach:${id}:company_1/${id}-1.jpg:company_1/${id}-sig-1.png`));
  }
  assert.deepEqual(calls.filter((call) => call.startsWith("render:")).sort(), ["render:0", "render:1", "render:2", "render:3"]);
});

test("DEMO-REFONTE : hors stock de démo, aucun fichier ni purge", async () => {
  let touched = false;
  const result = await attachDemoProofFiles("base", ["d1"], {
    isPoolCompany: async () => false,
    purge: async () => { touched = true; },
    uploadPhoto: async () => { touched = true; return ""; },
  });
  assert.deepEqual(result, { status: "skipped", reason: "NOT_A_POOL_ENVIRONMENT" });
  assert.equal(touched, false);
});

test("DEMO-REFONTE : une panne du stockage n'empêche pas la démo (aucune exception)", async () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    const result = await attachDemoProofFiles("company_1", ["d1"], {
      isPoolCompany: async () => true,
      purge: async () => {},
      render: fakeFiles,
      uploadPhoto: async () => { throw new Error("POD_UPLOAD: down"); },
      uploadSignature: async () => "x",
      attach: async () => { throw new Error("ne doit pas être appelé"); },
    });
    assert.deepEqual(result, { status: "failed", reason: "POD_UPLOAD: down" });
  } finally {
    console.warn = original;
  }
});

test("DEMO-REFONTE : la remise à neuf joint les fichiers aux livrées du jour (4)", () => {
  const items = buildScenario(demoScenarioAnchor(new Date("2026-11-05T10:07:00.000Z")));
  assert.equal(items.filter((item) => item.proof && item.completedAtOffsetHours != null).length, 4);
  const source = readFileSync("src/domains/demo/demo-scenario.service.ts", "utf8");
  assert.match(source, /if \(scenario\.proof && scenario\.completedAtOffsetHours != null\) deliveredWithProof\.push\(deliveryId\)/);
  assert.match(source, /await attachDemoProofFiles\(companyId, deliveredWithProof\);/);
});
