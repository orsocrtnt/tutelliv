import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPACT_STATUS_LABELS,
  FULFILLMENT_STATUS_LABELS,
  getCompactStatusLabel,
  getFulfillmentStatusLabel,
} from "../src/lib/constants/order-status";
import { DISPATCH_MAP_STATUSES } from "../src/features/back-office/dispatch-map-status";
import { formatDriverFromParts } from "../src/lib/format/person-labels";

// AUDIT-0411, décision du propriétaire du 9 novembre 2026 : un seul mot par statut, au féminin.
const OLD_WORDS = /^(Attente|En attente|À démarrer|En cours|En route|En cours de route|En cours de livraison|Achats|Assigné|Livré|Annulé|Facturé|Payé|Collecté|Non assigné)$/;

test("statuts : libellé long et court identiques, sauf devis et échec", () => {
  for (const status of Object.keys(FULFILLMENT_STATUS_LABELS) as (keyof typeof FULFILLMENT_STATUS_LABELS)[]) {
    if (status === "QUOTE_REQUESTED" || status === "FAILED") continue;
    assert.equal(COMPACT_STATUS_LABELS[status], FULFILLMENT_STATUS_LABELS[status], status);
  }
  assert.equal(FULFILLMENT_STATUS_LABELS.PENDING, "Sans livreur");
  assert.equal(FULFILLMENT_STATUS_LABELS.ASSIGNED, "Assignée");
  assert.equal(FULFILLMENT_STATUS_LABELS.IN_DELIVERY, "En livraison");
  assert.equal(FULFILLMENT_STATUS_LABELS.DELIVERED, "Livrée");
  assert.equal(getFulfillmentStatusLabel("PURCHASING", "COURIER"), "Collectée");
  assert.equal(getCompactStatusLabel("PURCHASING", "COURIER"), "Collectée");
});

test("statuts : aucun ancien mot dans les libellés, la carte ni le livreur absent", () => {
  const labels = [
    ...Object.values(FULFILLMENT_STATUS_LABELS),
    ...Object.values(COMPACT_STATUS_LABELS),
    ...DISPATCH_MAP_STATUSES.map((status) => status.label),
    formatDriverFromParts(null, null),
  ];
  for (const label of labels) assert.doesNotMatch(label, OLD_WORDS);
  assert.deepEqual(DISPATCH_MAP_STATUSES.map((status) => status.label), ["En retard", "Sans livreur", "Assignées", "En livraison"]);
  assert.equal(formatDriverFromParts(null, null), "Sans livreur");
});
