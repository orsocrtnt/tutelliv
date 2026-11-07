import assert from "node:assert/strict";
import test from "node:test";
import { clientDetail, clientDisplayName, searchClients } from "../src/features/back-office/client-search";

const clients = [
  { id: "1", firstName: "Pharmacie", lastName: "du Marais", email: "contact.ab12cd@pharmacie-du-marais.demo", phone: "0612345678" },
  { id: "2", firstName: "Cabinet", lastName: "Lefèvre Avocats", email: "accueil@lefevre.fr", phone: null },
  { id: "3", firstName: "", lastName: "", email: "sans-nom@exemple.fr", phone: null },
  { id: "4", firstName: "Atelier", lastName: "Nation", email: "atelier@nation.fr", phone: "+33 6 98 76 54 32" },
];

test("recherche sans accents ni majuscules, sur plusieurs mots", () => {
  assert.deepEqual(searchClients(clients, "lefevre").map((c) => c.id), ["2"]);
  assert.deepEqual(searchClients(clients, "CABINET avo").map((c) => c.id), ["2"]);
  assert.deepEqual(searchClients(clients, "marais pharma").map((c) => c.id), ["1"]);
});

test("recherche par e-mail et par téléphone, avec ou sans espaces", () => {
  assert.deepEqual(searchClients(clients, "sans-nom@").map((c) => c.id), ["3"]);
  assert.deepEqual(searchClients(clients, "06 12 34").map((c) => c.id), ["1"]);
  assert.deepEqual(searchClients(clients, "0612").map((c) => c.id), ["1"]);
  assert.deepEqual(searchClients(clients, "98 76").map((c) => c.id), ["4"]);
});

test("saisie vide : tous les clients par ordre alphabétique ; nom qui commence par la saisie en premier", () => {
  assert.deepEqual(searchClients(clients, "  ").map((c) => c.id), ["4", "2", "1", "3"]);
  const ordered = searchClients(
    [
      { id: "a", firstName: "Boulangerie", lastName: "Nation", email: "b@x.fr", phone: null },
      { id: "b", firstName: "Nation", lastName: "Fleurs", email: "n@x.fr", phone: null },
    ],
    "nation"
  );
  assert.deepEqual(ordered.map((c) => c.id), ["b", "a"]);
});

test("aucun résultat quand rien ne correspond", () => {
  assert.deepEqual(searchClients(clients, "boulangerie"), []);
});

test("affichage : nom, puis téléphone lisible, l'e-mail seulement à défaut", () => {
  assert.equal(clientDisplayName(clients[0]!), "Pharmacie du Marais");
  assert.equal(clientDetail(clients[0]!), "06 12 34 56 78");
  assert.equal(clientDetail(clients[1]!), "accueil@lefevre.fr");
  assert.equal(clientDisplayName(clients[2]!), "sans-nom@exemple.fr");
  assert.equal(clientDetail(clients[2]!), null);
});
