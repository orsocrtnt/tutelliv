import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearDemoChecklist,
  DEMO_CHECKLIST_STEPS,
  DEMO_CHECKLIST_STORAGE_KEY,
  demoChecklistStepForPath,
  nextDemoChecklistStep,
  readActiveDemoChecklistStep,
  readDemoChecklist,
  recordDemoChecklistStep,
  writeActiveDemoChecklistStep,
} from "../src/lib/demo/demo-checklist";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

test("la liste « À essayer » compte quatre étapes, chacune dans sa vue, avec une consigne concrète", () => {
  for (const step of DEMO_CHECKLIST_STEPS) assert.ok(step.how.length > 30 && step.how.endsWith("."), `consigne de ${step.id}`);
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

test("une étape se coche toute seule dans n'importe quelle vue, une seule fois, et se garde dans l'ordre de la liste", () => {
  const storage = memoryStorage();
  // Retour du propriétaire : une preuve ouverte en vue Administrateur ne cochait rien.
  assert.equal(recordDemoChecklistStep(storage, "invoice"), true);
  assert.equal(recordDemoChecklistStep(storage, "assign"), true);
  assert.equal(recordDemoChecklistStep(storage, "assign"), false, "déjà cochée");
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
  assert.equal(recordDemoChecklistStep(storage, "track"), true);
  assert.deepEqual(readDemoChecklist(storage), ["track", "deliver"]);
});

test("étape en cours : rappelée jusqu'à ce qu'elle soit faite, puis l'étape suivante est proposée", () => {
  const storage = memoryStorage();
  writeActiveDemoChecklistStep(storage, "track");
  assert.equal(readActiveDemoChecklistStep(storage), "track");
  recordDemoChecklistStep(storage, "assign");
  assert.equal(readActiveDemoChecklistStep(storage), "track", "une autre étape faite ne ferme pas la bande");
  recordDemoChecklistStep(storage, "track");
  assert.equal(readActiveDemoChecklistStep(storage), null, "étape faite : la bande disparaît");
  assert.equal(nextDemoChecklistStep(readDemoChecklist(storage))?.id, "deliver");
  writeActiveDemoChecklistStep(storage, "assign");
  assert.equal(readActiveDemoChecklistStep(storage), null, "une étape déjà faite n'est jamais rappelée");
  writeActiveDemoChecklistStep(storage, "invoice");
  clearDemoChecklist(storage);
  assert.equal(readActiveDemoChecklistStep(storage), null);
  assert.equal(nextDemoChecklistStep(["assign", "track", "deliver", "invoice"]), null);
});

test("ouvrir une livraison, la carte en direct ou une facture coche l'étape ; les simples listes non", () => {
  assert.equal(demoChecklistStepForPath("/portal/deliveries"), null, "la consigne doit rester lisible à l'arrivée");
  assert.equal(demoChecklistStepForPath("/portal/deliveries/abc"), "track");
  assert.equal(demoChecklistStepForPath("/dispatch/map"), "track");
  assert.equal(demoChecklistStepForPath("/portal/invoices/abc"), "invoice");
  assert.equal(demoChecklistStepForPath("/portal/invoices"), null);
  assert.equal(demoChecklistStepForPath("/dispatch"), null);
});

test("les actions réelles cochent la liste, et une démo neuve ou réinitialisée la vide", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const backOffice = read("src/features/back-office/hooks.ts");
  assert.equal(backOffice.match(/markDemoChecklistStep\("assign"\)/g)?.length, 2, "affectation directe et suggestion");
  assert.match(read("src/features/client-portal/portal-deliveries-map.tsx"), /markDemoChecklistStep\("track"\)/, "clic sur une livraison de la carte");
  assert.match(read("src/features/driver/hooks.ts"), /status === "DELIVERED"\) markDemoChecklistStep\("deliver"\)/);
  assert.match(read("src/features/deliveries/proof-of-delivery-card.tsx"), /markDemoChecklistStep\("invoice"\)/);
  assert.match(read("src/features/demo/demo-launcher.tsx"), /resetDemoChecklist\(\)/);
  assert.match(read("src/features/demo/demo-mode-bar.tsx"), /resetDemoChecklist\(\)/);
  // Aucun suivi envoyé au serveur : la liste ne vit que dans l'onglet.
  assert.doesNotMatch(read("src/features/demo/demo-checklist.ts"), /fetch\(/);
});

test("l'annonce d'une étape faite est décalée (plantage « removeChild » pendant la fermeture du choix de livreur)", () => {
  const source = readFileSync(new URL("../src/features/demo/demo-checklist.ts", import.meta.url), "utf8");
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*window\.dispatchEvent\(new CustomEvent\(DEMO_CHECKLIST_EVENT, \{ detail: \{ id \} \}\)\);/);
});
