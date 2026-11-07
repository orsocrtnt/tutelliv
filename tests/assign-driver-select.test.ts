import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Plantage « removeChild » de /dispatch à l'affectation (6 novembre 2026) : un Select non contrôlé
// (value undefined) sans contenu explicite laisse Radix recopier le nom dans le bouton, que React réécrit ensuite.
test("le choix du livreur reste contrôlé et garde un contenu explicite", () => {
  const source = readFileSync(new URL("../src/features/back-office/assign-driver-select.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /value=\{driverId \|\| undefined\}/);
  assert.match(source, /value=\{driverId \?\? ""\}/);
  assert.doesNotMatch(source, /withoutRolePrefix\(assignedLabel\) : undefined/);
});
