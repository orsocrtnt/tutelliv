import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearDemoChecklist,
  DEMO_CHECKLIST_STEPS,
  DEMO_CHECKLIST_STORAGE_KEY,
  demoChecklistStepForPath,
  readDemoChecklist,
  recordDemoChecklistStep,
} from "../src/lib/demo/demo-checklist";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

test("la liste « À essayer » compte quatre étapes, chacune dans sa vue", () => {
  assert.deepEqual(
    DEMO_CHECKLIST_STEPS.map((step) => [step.id, step.persona]),
    [
      ["assign", "admin"],
      ["track", "client"],
      ["deliver", "driver"],
      ["invoice", "client"],
    ]
  );
});

test("une étape ne se coche que dans sa vue, une seule fois, et se garde dans l'ordre de la liste", () => {
  const storage = memoryStorage();
  assert.equal(recordDemoChecklistStep(storage, "invoice", "admin"), false, "preuve ouverte par l'administrateur");
  assert.deepEqual(readDemoChecklist(storage), []);

  assert.equal(recordDemoChecklistStep(storage, "invoice", "client"), true);
  assert.equal(recordDemoChecklistStep(storage, "assign", "admin"), true);
  assert.equal(recordDemoChecklistStep(storage, "assign", "admin"), false, "déjà cochée");
  assert.deepEqual(readDemoChecklist(storage), ["assign", "invoice"]);

  clearDemoChecklist(storage);
  assert.deepEqual(readDemoChecklist(storage), []);
});

test("une valeur abîmée ou inconnue dans l'onglet ne casse pas la liste", () => {
  const storage = memoryStorage();
  storage.setItem(DEMO_CHECKLIST_STORAGE_KEY, "{pas du json");
  assert.deepEqual(readDemoChecklist(storage), []);
  storage.setItem(DEMO_CHECKLIST_STORAGE_KEY, JSON.stringify(["deliver", "inconnue", 3, "deliver"]));
  assert.deepEqual(readDemoChecklist(storage), ["deliver"]);
  assert.equal(recordDemoChecklistStep(storage, "track", "client"), true);
  assert.deepEqual(readDemoChecklist(storage), ["track", "deliver"]);
});

test("ouvrir la carte des livraisons ou une facture coche l'étape ; la liste des factures non", () => {
  assert.equal(demoChecklistStepForPath("/portal/deliveries"), "track");
  assert.equal(demoChecklistStepForPath("/portal/deliveries/abc"), "track");
  assert.equal(demoChecklistStepForPath("/portal/invoices/abc"), "invoice");
  assert.equal(demoChecklistStepForPath("/portal/invoices"), null);
  assert.equal(demoChecklistStepForPath("/dispatch"), null);
});

test("les actions réelles cochent la liste, et une démo neuve ou réinitialisée la vide", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const backOffice = read("src/features/back-office/hooks.ts");
  assert.equal(backOffice.match(/markDemoChecklistStep\("assign"\)/g)?.length, 2, "affectation directe et suggestion");
  assert.match(read("src/features/driver/hooks.ts"), /status === "DELIVERED"\) markDemoChecklistStep\("deliver"\)/);
  assert.match(read("src/features/deliveries/proof-of-delivery-card.tsx"), /markDemoChecklistStep\("invoice"\)/);
  assert.match(read("src/features/demo/demo-launcher.tsx"), /resetDemoChecklist\(\)/);
  assert.match(read("src/features/demo/demo-mode-bar.tsx"), /resetDemoChecklist\(\)/);
  // Aucun suivi envoyé au serveur : la liste ne vit que dans l'onglet.
  assert.doesNotMatch(read("src/features/demo/demo-checklist.ts"), /fetch\(/);
});
