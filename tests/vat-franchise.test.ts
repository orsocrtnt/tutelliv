import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isVatFranchise, priceTaxSuffix, totalTaxSuffix, VAT_FRANCHISE_MENTION } from "../src/domains/billing/vat-display";
import { buildSignupPlanComparison, type SignupCatalog } from "../src/features/auth/signup-plan-comparison";
import { buildSessionSeatMeter, seatRemainingLabel } from "../src/domains/saas/saas-access";

const plan = { code: "STARTER" as const, name: "Starter", monthlyPriceCents: 7900, annualPriceCents: 79000, includedDriverSeats: 5, unlimitedDriverSeats: false, maxDriverSeats: 10, includedAdminSeats: 1, maxAdminSeats: 1, includedDispatcherSeats: 0, maxDispatcherSeats: null, includedMonthlyOrders: 1000, orderOverageUnitPriceCents: 10, includedFeatures: [] };
const gps = { code: "ADMIN_GPS", name: "Carte GPS administrateur", kind: "OPTION" as const, featureKey: "admin_gps", monthlyPriceCents: 3900, annualPriceCents: 46800, applicablePlans: ["STARTER" as const] };
const catalog = (vatRateBps: number) => ({ currency: "EUR", vatRateBps, plans: [plan], options: [gps] }) as unknown as SignupCatalog;
const texts = (vatRateBps: number) => JSON.stringify(buildSignupPlanComparison(catalog(vatRateBps), "MONTHLY"));

test("TVA : 0 % = franchise, prix sans HT ni TTC ; taux inconnu ou 20 % = HT/TTC", () => {
  assert.equal(VAT_FRANCHISE_MENTION, "TVA non applicable, art. 293 B du CGI");
  assert.equal(isVatFranchise(0), true);
  assert.equal(priceTaxSuffix(0), "");
  assert.equal(totalTaxSuffix(0), "");
  for (const rate of [2000, null, undefined]) {
    assert.equal(isVatFranchise(rate), false);
    assert.equal(priceTaxSuffix(rate), " HT");
    assert.equal(totalTaxSuffix(rate), " TTC");
  }
});

test("TVA : le tableau des formules suit le taux du catalogue", () => {
  const franchise = texts(0);
  assert.ok(franchise.includes('"label":"Prix / mois"'));
  assert.doesNotMatch(franchise, /\bHT\b/);
  const taxed = texts(2000);
  assert.ok(taxed.includes('"label":"Prix HT / mois"'));
  assert.match(taxed, /HT, sans blocage/);
});

test("TVA : le poste supplémentaire suit le taux du catalogue", () => {
  const meter = (vatRateBps: number | null) => buildSessionSeatMeter({ used: 5, limit: 5, hardMax: 10, extraMonthlyPriceCents: 1200, vatRateBps });
  assert.match(seatRemainingLabel(meter(0)), /12,00\s€ \/ mois pour en ajouter un/);
  assert.match(seatRemainingLabel(meter(2000)), /12,00\s€ HT \/ mois/);
  assert.match(seatRemainingLabel(meter(null)), /HT \/ mois/);
});

test("TVA : migration de données qui passe le catalogue actif à 0 %, sans changer le schéma", () => {
  const sql = readFileSync("prisma/migrations/20261113120000_catalog_vat_franchise/migration.sql", "utf8");
  assert.match(sql, /UPDATE saas_catalog_versions\s+SET vat_rate_bps = 0/);
  assert.match(sql, /WHERE code = 'C11-2026-11-04' AND status = 'ACTIVE'/);
  assert.doesNotMatch(sql, /ALTER|DROP|DELETE|INSERT/i);
});
