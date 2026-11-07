import assert from "node:assert/strict";
import test from "node:test";
import { formatPhoneDisplay, phoneHref } from "../src/lib/format/phone";

test("téléphone lisible : numéros français groupés par deux, le reste affiché tel quel", () => {
  assert.equal(formatPhoneDisplay("0612345678"), "06 12 34 56 78");
  assert.equal(formatPhoneDisplay("06.12.34.56.78"), "06 12 34 56 78");
  assert.equal(formatPhoneDisplay("+33612345678"), "+33 6 12 34 56 78");
  assert.equal(formatPhoneDisplay("0033 1 23 45 67 89"), "+33 1 23 45 67 89");
  assert.equal(formatPhoneDisplay("+1 212 555 0100"), "+1 212 555 0100");
  assert.equal(formatPhoneDisplay("06123"), "06123");
  assert.equal(formatPhoneDisplay(null), "");
});

test("lien d'appel : chiffres et + seulement, quel que soit l'affichage", () => {
  assert.equal(phoneHref("06 12 34 56 78"), "tel:0612345678");
  assert.equal(phoneHref("+33 (0)6-12"), "tel:+330612");
});
