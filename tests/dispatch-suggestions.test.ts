import assert from "node:assert/strict";
import * as driverQueue from "../src/lib/dispatch/driver-queue";
import * as roundOrder from "../src/lib/dispatch/round-order";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as eligibility from "../src/lib/dispatch/driver-eligibility";
import * as proximityLib from "../src/lib/dispatch/dispatch-proximity";
import * as trackingPolicy from "../src/domains/tracking/tracking.policy";
import * as dispatchSettings from "../src/lib/validations/dispatch-settings";
import * as dispatchScore from "../src/lib/dispatch/dispatch-score";
import * as travelTime from "../src/lib/dispatch/travel-time";
import * as pluralLib from "../src/lib/format/plural";
import {
  DISPATCH_SCORE_WEIGHTS,
  explainCandidate,
  rankDispatchCandidates,
  scoreCandidate,
  type ScoreCandidate,
} from "../src/lib/dispatch/dispatch-score";

type Row = Record<string, unknown>;
type Service = {
  resolveDriverForDelivery: (delivery: Row, settings: Row, drivers: Row[], zones: Row[], proximities?: Map<string, unknown>, travel?: Map<string, unknown>) => { driverId: string; reason: string } | null;
  tryAutoAssignDelivery: (company: string, id: string) => Promise<Row>;
  runAutoDispatchQueue: (company: string) => Promise<{ assigned: number; skipped: number; results: Row[]; message?: string }>;
  getDispatchSuggestions: (company: string, id: string) => Promise<Row | null>;
  assignFromSuggestion: (company: string, delivery: string, driver: string) => Promise<unknown>;
};

const NO_POSITION_DATA = /latitude|longitude|driverLocation|email|phone|"settings"|distanceMeters/;
const HISTORY_SAFE = /km|\d+\s?m\b|min|position/i;
const PICKUP = { pickupLatitude: 48.8566, pickupLongitude: 2.3522 };
const fresh = (dLat: number) => ({
  settings: { trackingService: { active: true, startedAt: new Date().toISOString() } },
  driverLocation: { latitude: PICKUP.pickupLatitude + dLat, longitude: PICKUP.pickupLongitude, updatedAt: new Date() },
});

/** Charge le service réel ; seules les frontières (Prisma, réseau OSRM, réglages) sont simulées. */
function load(deps: {
  settings: Row;
  delivery?: Row | null;
  drivers?: Row[];
  osrm?: (url: string) => { status: number; body: unknown };
  assign?: (...args: unknown[]) => Promise<unknown>;
  zone?: Row | null;
  log?: string[];
  /** Livraisons en cours des livreurs (file lue par le score). */
  missions?: Row[];
}) {
  const log = deps.log ?? [];
  const state = travelTime.createTravelTimeState();
  const deliveryQueries: Row[] = [];
  const module = { exports: {} };
  const prisma = {
    delivery: {
      findFirst: async (args: Row) => { deliveryQueries.push(args); return deps.delivery ?? null; },
      findMany: async (args: { where?: { driverId?: { in?: string[] } } } = {}) =>
        args.where?.driverId?.in
          ? (deps.missions ?? []).filter((m) => args.where!.driverId!.in!.includes(m.driverId as string))
          : deps.delivery ? [deps.delivery] : [],
    },
  };
  const travel = {
    ...travelTime,
    estimateTravelTimes: (origins: unknown, destination: unknown, options: Row = {}) =>
      travelTime.estimateTravelTimes(origins as never, destination as never, {
        ...options,
        state,
        baseUrl: deps.osrm ? "https://osrm.example.test" : null,
        fetchImpl: async (url: string) => {
          log.push("osrm");
          const reply = deps.osrm!(url);
          return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
        },
      }),
  };
  const all: Record<string, unknown> = {
    "@/services/prisma/client": { prisma },
    "@/domains/company/dispatch-settings.service": { getCompanyDispatchSettings: async () => deps.settings },
    "@/domains/company/tariff-settings.service": { getCompanyTariffSettings: async () => ({ tariffZones: [] }) },
    "@/lib/tariff/find-tariff-zone": { findTariffZoneForPostalCode: () => deps.zone ?? null },
    "@/domains/delivery/delivery.service": {
      getCompanyDriversWithActivity: async () => deps.drivers ?? [],
      assignDeliveryToDriver: async (...args: unknown[]) => { log.push("assign"); return deps.assign ? deps.assign(...args) : { id: "d1" }; },
    },
    "@/lib/dispatch/driver-eligibility": eligibility,
    "@/lib/dispatch/dispatch-proximity": proximityLib,
    "@/domains/tracking/tracking.policy": trackingPolicy,
    "@/lib/query/list-limits": { AUTO_DISPATCH_QUEUE_TAKE: 100 },
    "@/lib/validations/dispatch-settings": dispatchSettings,
    "@/lib/dispatch/dispatch-score": dispatchScore,
    "@/lib/dispatch/driver-queue": driverQueue,
    "@/lib/dispatch/round-order": roundOrder,
    "@/lib/format/plural": pluralLib,
    "@/lib/dispatch/travel-time": travel,
  };
  runInNewContext(ts.transpileModule(readFileSync(resolve("src/domains/delivery/auto-dispatch.service.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { Date, Math, Map, Set, Error, Promise, Number, console, exports: module.exports, module,
    require: (id: string) => { assert.ok(id in all, id); return all[id]; } });
  return { svc: module.exports as Service, log, deliveryQueries };
}

const base = dispatchSettings.DEFAULT_DISPATCH_SETTINGS;
const scoreSettings = { ...base, enabled: true, bestScore: true };
const pending = { id: "d1", driverId: null, status: "PENDING", deliveryCategory: "STANDARD", postalCode: "75011", pickupPostalCode: null, createdAt: new Date(), ...PICKUP };
const driver = (id: string, assigned: number, extra: Row = {}) => ({ id, firstName: `E2E ${id}`, lastName: "Livreur", email: `${id}@e2e.invalid`, phone: "0600000000", assigned, inTransit: 0, ...extra });
const candidate = (over: Partial<ScoreCandidate>): ScoreCandidate => ({
  id: "x", load: 0, maxLoad: 3, priority: null, zone: "ANY", zoneName: null, travel: null, positionStatus: "NO_POSITION", ...over,
});

test("plafond par défaut : 6 livraisons en cours (DISPATCH-5, décision du 9 novembre 2026)", () => {
  assert.equal(base.maxActiveDeliveriesPerDriver, 6);
  assert.equal(dispatchSettings.companyDispatchSettingsSchema.parse({ ...base, maxActiveDeliveriesPerDriver: undefined }).maxActiveDeliveriesPerDriver, 6);
});

test("score : poids documentés (somme 1) et bornes 0–100", () => {
  const sum = Object.values(DISPATCH_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum * 1000), 1000);
  const best = scoreCandidate(candidate({ travel: { source: "ROUTE", seconds: 0 }, zone: "PREFERRED", priority: 1 }));
  const worst = scoreCandidate(candidate({ travel: { source: "ROUTE", seconds: 4 * 3600 }, load: 3, priority: null }));
  assert.equal(best, 100);
  assert.equal(worst, 5, "seule la part « sans restriction de zone » reste");
});

test("score : un trajet court l'emporte sur une charge plus faible ; hors service jamais favorisé", () => {
  const ranked = rankDispatchCandidates([
    candidate({ id: "loin-libre", travel: { source: "ROUTE", seconds: 40 * 60 } }),
    candidate({ id: "proche-occupe", load: 1, travel: { source: "ROUTE", seconds: 4 * 60 } }),
    candidate({ id: "inconnu", positionStatus: "OFF_DUTY" }),
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["proche-occupe", "loin-libre", "inconnu"]);
  // Sans GPS pour personne, le trajet est neutre : seule la charge départage.
  const noGps = rankDispatchCandidates([
    candidate({ id: "occupe", load: 1, positionStatus: "DISABLED" }),
    candidate({ id: "libre", positionStatus: "DISABLED" }),
  ]);
  assert.deepEqual(noGps.map((r) => r.id), ["libre", "occupe"]);
  // En service sans position : derrière un livreur localisé proche, devant un hors service.
  const unknown = rankDispatchCandidates([
    candidate({ id: "hors-service", positionStatus: "OFF_DUTY" }),
    candidate({ id: "sans-position", positionStatus: "NO_POSITION" }),
    candidate({ id: "localise", travel: { source: "ROUTE", seconds: 300 } }),
  ]);
  assert.deepEqual(unknown.map((r) => r.id), ["localise", "sans-position", "hors-service"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test("score : égalité stricte départagée par trajet, charge puis id (ordre total)", () => {
  const a = candidate({ id: "b" });
  const b = candidate({ id: "a" });
  assert.deepEqual(rankDispatchCandidates([a, b]).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(rankDispatchCandidates([b, a]).map((r) => r.id), ["a", "b"]);
});

test("explication : une phrase lisible avec trajet, charge, zone, priorité et raison du repli", () => {
  assert.equal(
    explainCandidate(candidate({ travel: { source: "ROUTE", seconds: 420 }, load: 1, zone: "PREFERRED", zoneName: "Centre", priority: 2 })),
    "Arrivée au retrait dans environ 22 min (dont 7 min de trajet routier), 1 livraison en cours sur 3, attitré à la zone « Centre », priorité 2."
  );
  assert.equal(
    explainCandidate(candidate({ travel: { source: "STRAIGHT_LINE", seconds: 600, fallbackReason: "UNAVAILABLE" } })),
    "Arrivée au retrait dans environ 10 min (à vol d'oiseau, service de trajet indisponible), aucune livraison en cours."
  );
  assert.equal(
    explainCandidate(candidate({ positionStatus: "STALE", load: 2 })),
    "Trajet inconnu (position trop ancienne), 2 livraisons en cours sur 3."
  );
});

test("auto meilleur score : trajet routier calculé AVANT l'affectation, raison d'historique sans chiffre", async () => {
  const log: string[] = [];
  const assigned: unknown[][] = [];
  const { svc } = load({
    settings: scoreSettings,
    delivery: pending,
    // « libre » est libre mais à 30 min ; « proche » a une livraison mais à 3 min.
    drivers: [driver("libre", 0, fresh(0.05)), driver("proche", 1, fresh(0.02))],
    osrm: (url) => {
      const n = new URL(url).searchParams.get("sources")!.split(";").length;
      assert.equal(n, 2);
      // Présélection par distance : « proche » (0,02°) en premier.
      return { status: 200, body: { code: "Ok", durations: [[180], [1800]] } };
    },
    assign: async (...args) => { assigned.push(args); return { id: "d1" }; },
    log,
  });
  const result = await svc.tryAutoAssignDelivery("c1", "d1");
  assert.equal(result.assigned, true);
  assert.equal(result.driverId, "proche");
  assert.deepEqual(log, ["osrm", "assign"], "aucun appel réseau pendant ou après la transaction");
  const options = assigned[0]![3] as Row;
  assert.equal(options.expectUnassigned, true);
  assert.equal(options.automatic, true);
  assert.equal(options.reason, "Meilleur score (heure d'arrivée, zone)");
  assert.doesNotMatch(String(options.reason), HISTORY_SAFE);
});

test("auto meilleur score : OSRM en panne → repli à vol d'oiseau, l'affectation se fait quand même", async () => {
  const { svc, log } = load({
    settings: scoreSettings,
    delivery: pending,
    drivers: [driver("libre", 0, fresh(0.05)), driver("proche", 1, fresh(0.005))],
    osrm: () => ({ status: 503, body: null }),
  });
  const result = await svc.tryAutoAssignDelivery("c1", "d1");
  assert.equal(result.assigned, true);
  assert.equal(result.driverId, "proche");
  assert.deepEqual(log, ["osrm", "assign"]);
});

test("réglages hérités : sans `bestScore`, défaut faux ; l'ancien schéma ignore le champ (retour arrière sûr)", () => {
  const legacy = dispatchSettings.companyDispatchSettingsSchema.parse({ ...base, bestScore: undefined });
  assert.equal(legacy.bestScore, false);
  const oldSchema = dispatchSettings.companyDispatchSettingsSchema.omit({ bestScore: true });
  const readByOldCode = oldSchema.parse({ ...base, strategy: "LEAST_LOADED", bestScore: true });
  assert.equal(readByOldCode.strategy, "LEAST_LOADED");
  assert.equal("bestScore" in readByOldCode, false);
});

test("auto : les autres stratégies n'appellent jamais le service de trajet (comportement hérité)", async () => {
  for (const strategy of ["PRIORITY_LIST", "LEAST_LOADED", "ZONE_THEN_PRIORITY"]) {
    const { svc, log } = load({
      settings: { ...base, enabled: true, strategy },
      delivery: pending,
      drivers: [driver("a", 0, fresh(0.01)), driver("b", 1, fresh(0.02))],
      osrm: () => { throw new Error("ne doit pas être appelé"); },
    });
    const result = await svc.tryAutoAssignDelivery("c1", "d1");
    assert.equal(result.assigned, true, strategy);
    assert.deepEqual(log, ["assign"], strategy);
  }
});

test("mode suggestion : la file refuse d'affecter en masse, rien n'est affecté", async () => {
  const { svc, log } = load({ settings: { ...base, enabled: false, bestScore: true }, delivery: pending, drivers: [driver("a", 0)] });
  const queue = await svc.runAutoDispatchQueue("c1");
  assert.equal(queue.assigned, 0);
  assert.match(String(queue.message), /Mode suggestion/);
  const single = await svc.tryAutoAssignDelivery("c1", "d1");
  assert.equal(single.assigned, false);
  assert.equal(single.skippedReason, "Auto-dispatch désactivé", "raison terminale du job inchangée : pas de relance");
  assert.deepEqual(log, []);
});

test("suggestions : 3 meilleurs, explication, aucune coordonnée ni contact, requête limitée à l'entreprise", async () => {
  const { svc, deliveryQueries } = load({
    settings: { ...base, enabled: false, maxActiveDeliveriesPerDriver: 3 },
    delivery: pending,
    drivers: [
      driver("a", 0, fresh(0.01)),
      driver("b", 2, fresh(0.002)),
      driver("c", 0, { settings: { trackingService: { active: false } }, driverLocation: fresh(0.001).driverLocation }),
      driver("d", 3, fresh(0.001)),
      driver("e", 1),
    ],
    // « b » a deux livraisons en cours à environ 2 km : sa file compte (DISPATCH-5).
    missions: [
      { id: "m1", driverId: "b", status: "ASSIGNED", latitude: PICKUP.pickupLatitude + 0.02, longitude: PICKUP.pickupLongitude, pickupLatitude: null, pickupLongitude: null, roundId: null, roundSequence: null },
      { id: "m2", driverId: "b", status: "IN_DELIVERY", latitude: PICKUP.pickupLatitude + 0.02, longitude: PICKUP.pickupLongitude, pickupLatitude: null, pickupLongitude: null, roundId: null, roundSequence: null },
    ],
    osrm: (url) => {
      // Seuls les livreurs en service partent au service de trajet : 10 min chacun depuis la fin de sa file.
      assert.equal(new URL(url).searchParams.get("sources"), "0;1");
      return { status: 200, body: { code: "Ok", durations: [[600], [600]] } };
    },
  });
  const result = await svc.getDispatchSuggestions("c1", "d1");
  assert.ok(result);
  assert.equal((deliveryQueries[0]!.where as Row).companyId, "c1");
  assert.equal(result.mode, "SUGGESTION");
  assert.equal(result.assignable, true);
  assert.equal(result.eligibleCount, 4, "« d » a atteint le plafond de charge (3)");
  const suggestions = result.suggestions as Row[];
  assert.equal(suggestions.length, 3);
  assert.deepEqual(suggestions.map((s) => s.rank), [1, 2, 3]);
  // a : libre, arrivée dans 10 min (82) ; b : tout près mais 2 livraisons à finir d'abord, 26 min (76) ;
  // c : hors service, libre (5) ; e : hors service, 1 livraison (5), 4e donc absent.
  assert.deepEqual(suggestions.map((s) => s.driverId), ["a", "b", "c"]);
  assert.deepEqual(suggestions.map((s) => s.score), [82, 76, 5]);
  assert.deepEqual(suggestions.map((s) => s.travelMinutes), [10, 26, null]);
  assert.deepEqual(suggestions.map((s) => s.travelSource), ["ROUTE", "ROUTE", null]);
  assert.match(String(suggestions[1]!.explanation), /dans environ 26 min \(dont 10 min de trajet routier\), 2 livraisons en cours/);
  assert.match(String(suggestions[2]!.explanation), /hors service/);
  for (const s of suggestions) {
    assert.equal(typeof s.explanation, "string");
    assert.ok(Number(s.score) >= 0 && Number(s.score) <= 100);
  }
  assert.doesNotMatch(JSON.stringify(result), NO_POSITION_DATA);
});

test("suggestions : livraison déjà affectée ou introuvable → rien n'est calculé", async () => {
  const assigned = load({ settings: base, delivery: { ...pending, driverId: "x", status: "ASSIGNED" }, drivers: [driver("a", 0, fresh(0.01))], osrm: () => { throw new Error("pas d'appel"); } });
  const result = await assigned.svc.getDispatchSuggestions("c1", "d1");
  assert.deepEqual({ ...result, suggestions: [...(result!.suggestions as unknown[])] }, { deliveryId: "d1", assignable: false, mode: "SUGGESTION", eligibleCount: 0, suggestions: [] });
  assert.deepEqual(assigned.log, []);
  const missing = load({ settings: base, delivery: null });
  assert.equal(await missing.svc.getDispatchSuggestions("c1", "d1"), null);
});

test("suggestions : aucun livreur compatible → liste vide (choix manuel seulement)", async () => {
  const { svc } = load({ settings: { ...base, maxActiveDeliveriesPerDriver: 1 }, delivery: pending, drivers: [driver("a", 1), driver("b", 2)] });
  const result = await svc.getDispatchSuggestions("c1", "d1");
  assert.equal(result!.eligibleCount, 0);
  assert.deepEqual([...(result!.suggestions as unknown[])], []);
});

test("affectation en un clic : jamais de remplacement silencieux, raison sans chiffre", async () => {
  const calls: unknown[][] = [];
  const { svc } = load({ settings: base, assign: async (...args) => { calls.push(args); return { id: "d1" }; } });
  await svc.assignFromSuggestion("c1", "d1", "a");
  assert.deepEqual(calls[0]!.slice(0, 3), ["c1", "d1", "a"]);
  const options = calls[0]![3] as Row;
  assert.equal(options.expectUnassigned, true);
  assert.equal(options.force, undefined, "le forçage reste réservé au choix manuel");
  assert.doesNotMatch(String(options.reason), HISTORY_SAFE);
});

test("file meilleur score : appels au service de trajet bornés sur tout le passage", async () => {
  let calls = 0;
  // 30 livraisons à des retraits distincts : aucun cache possible entre elles.
  const deliveries = Array.from({ length: 30 }, (_, i) => ({ ...pending, id: `q${i}`, pickupLatitude: 48.8 + i * 0.01 }));
  const queue = loadQueue(deliveries, (url) => {
    calls += 1;
    const n = new URL(url).searchParams.get("sources")!.split(";").length;
    return { status: 200, body: { code: "Ok", durations: Array.from({ length: n }, () => [60]) } };
  });
  const result = await queue.runAutoDispatchQueue("c1");
  assert.equal(result.results.length, 30);
  assert.equal(result.assigned, 30, "au-delà du budget, repli à vol d'oiseau : la file avance");
  assert.equal(calls, 20, "au plus 20 appels pour 30 livraisons, un par livraison");
});

function loadQueue(deliveries: Row[], osrm: (url: string) => { status: number; body: unknown }) {
  const state = travelTime.createTravelTimeState();
  const module = { exports: {} };
  const byId = new Map(deliveries.map((d) => [d.id as string, d]));
  const all: Record<string, unknown> = {
    "@/services/prisma/client": {
      prisma: {
        delivery: {
          findMany: async () => deliveries,
          findFirst: async (args: { where: { id: string } }) => byId.get(args.where.id) ?? null,
        },
      },
    },
    "@/domains/company/dispatch-settings.service": { getCompanyDispatchSettings: async () => scoreSettings },
    "@/domains/company/tariff-settings.service": { getCompanyTariffSettings: async () => ({ tariffZones: [] }) },
    "@/lib/tariff/find-tariff-zone": { findTariffZoneForPostalCode: () => null },
    "@/domains/delivery/delivery.service": {
      getCompanyDriversWithActivity: async () => [driver("a", 0, fresh(0.01)), driver("b", 0, fresh(0.02))],
      assignDeliveryToDriver: async () => ({ id: "x" }),
    },
    "@/lib/dispatch/driver-eligibility": eligibility,
    "@/lib/dispatch/dispatch-proximity": proximityLib,
    "@/domains/tracking/tracking.policy": trackingPolicy,
    "@/lib/query/list-limits": { AUTO_DISPATCH_QUEUE_TAKE: 100 },
    "@/lib/validations/dispatch-settings": dispatchSettings,
    "@/lib/dispatch/dispatch-score": dispatchScore,
    "@/lib/dispatch/driver-queue": driverQueue,
    "@/lib/dispatch/round-order": roundOrder,
    "@/lib/format/plural": pluralLib,
    "@/lib/dispatch/travel-time": {
      ...travelTime,
      estimateTravelTimes: (o: unknown, d: unknown, options: Row = {}) =>
        travelTime.estimateTravelTimes(o as never, d as never, {
          ...options, state, baseUrl: "https://osrm.example.test",
          fetchImpl: async (url: string) => { const r = osrm(url); return { ok: true, status: r.status, json: async () => r.body }; },
        }),
    },
  };
  runInNewContext(ts.transpileModule(readFileSync(resolve("src/domains/delivery/auto-dispatch.service.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { Date, Math, Map, Set, Error, Promise, Number, console, exports: module.exports, module,
    require: (id: string) => { assert.ok(id in all, id); return all[id]; } });
  return module.exports as Service;
}

test("DISPATCH-5 : file du livreur — retrait seulement s'il reste à faire, forfait sans coordonnées", () => {
  const start = { latitude: 48.85, longitude: 2.35 };
  const shop = { latitude: 48.86, longitude: 2.35 };
  const client = { latitude: 48.87, longitude: 2.35 };
  const leg = travelTime.straightLineSeconds;
  const waiting = driverQueue.estimateDriverQueue(start, [{ status: "ASSIGNED", pickup: shop, destination: client }]);
  assert.equal(waiting.seconds, leg(start, shop) + leg(shop, client) + 2 * driverQueue.QUEUE_STOP_SECONDS);
  assert.deepEqual(waiting.end, client);
  const onboard = driverQueue.estimateDriverQueue(start, [{ status: "IN_DELIVERY", pickup: shop, destination: client }]);
  assert.equal(onboard.seconds, leg(start, client) + driverQueue.QUEUE_STOP_SECONDS, "colis à bord : livraison seule");
  const unknown = driverQueue.estimateDriverQueue(start, [{ status: "ASSIGNED", pickup: null, destination: null }]);
  assert.equal(unknown.seconds, driverQueue.QUEUE_MISSION_FALLBACK_SECONDS);
  assert.deepEqual(unknown.end, start);
  assert.deepEqual(driverQueue.estimateDriverQueue(start, []), { seconds: 0, missions: 0, end: start });
});

test("DISPATCH-5 : sans retrait saisi, le score vise l'adresse de livraison", () => {
  assert.deepEqual(proximityLib.getDispatchTargetPoint({ pickupLatitude: 1, pickupLongitude: 2, latitude: 3, longitude: 4 }), { point: { latitude: 1, longitude: 2 }, kind: "PICKUP" });
  assert.deepEqual(proximityLib.getDispatchTargetPoint({ pickupLatitude: null, pickupLongitude: null, latitude: 3, longitude: 4 }), { point: { latitude: 3, longitude: 4 }, kind: "DROPOFF" });
  assert.equal(proximityLib.getDispatchTargetPoint({ latitude: null, longitude: 4 }), null);
  assert.equal(
    explainCandidate(candidate({ target: "DROPOFF", travel: { source: "ROUTE", seconds: 300 }, queueSeconds: 0 })),
    "Arrivée à l'adresse de livraison dans environ 5 min (trajet routier), aucune livraison en cours."
  );
});

test("DISPATCH-5 : créneau — le plus occupé qui le tient passe devant, celui qui le manque passe derrière", () => {
  const slot = { startsInSeconds: 2 * 3600, afterArrivalSeconds: 0 };
  const ranked = rankDispatchCandidates([
    candidate({ id: "libre", travel: { source: "ROUTE", seconds: 600 }, queueSeconds: 0, slot }),
    candidate({ id: "occupe-a-temps", load: 2, travel: { source: "ROUTE", seconds: 600 }, queueSeconds: 90 * 60, slot }),
    candidate({ id: "trop-tard", load: 2, travel: { source: "ROUTE", seconds: 600 }, queueSeconds: 2 * 3600, slot }),
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["occupe-a-temps", "libre", "trop-tard"]);
  assert.equal(ranked[0]!.score, ranked[1]!.score, "à temps tous les deux : même score, départagés par l'occupation");
  assert.match(ranked[0]!.explanation, /à temps pour le créneau/);
  assert.doesNotMatch(ranked[2]!.explanation, /à temps pour le créneau/);
  // Sans créneau : le premier arrivé, file comprise.
  const urgent = rankDispatchCandidates([
    candidate({ id: "proche-occupe", load: 2, travel: { source: "ROUTE", seconds: 120 }, queueSeconds: 40 * 60 }),
    candidate({ id: "loin-libre", travel: { source: "ROUTE", seconds: 20 * 60 }, queueSeconds: 0 }),
  ]);
  assert.deepEqual(urgent.map((r) => r.id), ["loin-libre", "proche-occupe"]);
});
