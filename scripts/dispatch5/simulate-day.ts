/**
 * DISPATCH-5, piste 6 (mesure) — simulation de journées de livraison pour juger le Dispatch intelligent.
 *
 * Rejoue des journées fictives à Marseille avec le vrai code d'affectation de TutelLiv :
 * - `resolveDriverForDelivery` (mode Automatique : score, ou « moins chargé ») ;
 * - `planRounds` (tournées automatiques).
 * et les compare à des références simples (au hasard, le plus proche, le premier disponible).
 *
 * Hypothèses (identiques pour toutes les stratégies) : trajets à vol d'oiseau de l'appli (30 km/h, détour 40 %),
 * 5 min par arrêt, livreur qui fait ses missions dans l'ordre reçu (une mission = retrait puis livraison),
 * position GPS fraîche, file retentée toutes les 10 min quand tout le monde est plein (comme la tâche AUTO_DISPATCH),
 * tournées automatiques recalculées toutes les 5 min (comme le cron). Aucune base, aucun réseau.
 *
 * Usage : npx tsx scripts/dispatch5/simulate-day.ts [graines=30] > outputs/dispatch5/simulation.md
 */
import { resolveDriverForDelivery } from "@/domains/delivery/auto-dispatch.service";
import { computeDispatchProximity, type DispatchProximity } from "@/lib/dispatch/dispatch-proximity";
import { estimateDriverQueue, type DriverQueue } from "@/lib/dispatch/driver-queue";
import { planRounds, type RoundDelivery, type RoundDriver, type RoundStop } from "@/lib/dispatch/round-planner";
import { straightLineSeconds, type GeoPoint, type TravelEstimate } from "@/lib/dispatch/travel-time";
import { DEFAULT_DISPATCH_SETTINGS, companyDispatchSettingsSchema, type CompanyDispatchSettings } from "@/lib/validations/dispatch-settings";

const MIN = 60_000;
const DAY_START = Date.UTC(2026, 10, 10, 7, 0); // 8 h à Marseille
const DAY_END = DAY_START + 13 * 60 * MIN; // fin du calcul à 21 h
const STOP_SECONDS = 5 * 60;
const RETRY_MS = 10 * MIN;
const ROUND_EVERY_MS = 5 * MIN;

const PICKUPS: GeoPoint[] = [
  { latitude: 43.2951, longitude: 5.374 }, // Vieux-Port
  { latitude: 43.3046, longitude: 5.3667 }, // La Joliette
  { latitude: 43.2856, longitude: 5.3836 }, // Castellane
  { latitude: 43.27, longitude: 5.389 }, // Prado
  { latitude: 43.295, longitude: 5.48 }, // La Valentine
  { latitude: 43.317, longitude: 5.407 }, // Saint-Just
];
const BASE: GeoPoint = { latitude: 43.3, longitude: 5.395 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

type Order = {
  id: string;
  createdAt: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  windowStart: number | null;
  deadline: number;
};

function makeDay(seed: number, count: number): Order[] {
  const r = rng(seed);
  const orders: Order[] = [];
  for (let i = 0; i < count; i += 1) {
    // Deux pointes (9 h-11 h et 14 h-16 h) sur un fond régulier.
    const u = r();
    const hour = u < 0.35 ? 1 + r() * 2 : u < 0.7 ? 6 + r() * 2 : r() * 9;
    const createdAt = DAY_START + Math.round(hour * 60) * MIN;
    const slot = r() < 0.3;
    const windowStart = slot ? createdAt + Math.round(120 + r() * 120) * MIN : null;
    orders.push({
      id: `d${String(i).padStart(3, "0")}`,
      createdAt,
      pickup: PICKUPS[Math.floor(r() * PICKUPS.length)]!,
      dropoff: { latitude: 43.29 + gauss(r) * 0.02, longitude: 5.39 + gauss(r) * 0.025 },
      windowStart,
      deadline: windowStart !== null ? windowStart + 120 * MIN : createdAt + 120 * MIN,
    });
  }
  return orders.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

const legSeconds = (from: GeoPoint, to: GeoPoint) => straightLineSeconds(from, to);
const legKm = (from: GeoPoint, to: GeoPoint) => (legSeconds(from, to) * (30 / 3600));

type Stop = { orderId: string; kind: "PICKUP" | "DROPOFF" };
type Leg = { stop: Stop; from: GeoPoint; to: GeoPoint; departAt: number; arriveAt: number; doneAt: number };

class Driver {
  pos: GeoPoint = BASE;
  clock = DAY_START;
  stops: Stop[] = [];
  leg: Leg | null = null;
  onboard = 0;
  km = 0;
  emptyKm = 0;
  delivered = 0;
  missions = new Set<string>();
  pickedUp = new Set<string>();
  constructor(readonly id: string) {}

  position(t: number): GeoPoint {
    const leg = this.leg;
    if (!leg || t >= leg.arriveAt) return leg && t >= leg.arriveAt ? leg.to : this.pos;
    const f = Math.max(0, (t - leg.departAt) / Math.max(1, leg.arriveAt - leg.departAt));
    return {
      latitude: leg.from.latitude + (leg.to.latitude - leg.from.latitude) * f,
      longitude: leg.from.longitude + (leg.to.longitude - leg.from.longitude) * f,
    };
  }

  /** Charge vue par l'appli : missions affectées et pas encore livrées, en attente ou en cours. */
  load() {
    let assigned = 0;
    let inTransit = 0;
    for (const id of this.missions) {
      if (this.pickedUp.has(id)) inTransit += 1;
      else assigned += 1;
    }
    return { assigned, inTransit };
  }

  /** Heure où le livreur aura fini tout ce qu'il a déjà (pour la référence « premier disponible »). */
  freeAtAndPos(t: number, orders: Map<string, Order>): { at: number; pos: GeoPoint } {
    let at = Math.max(t, this.leg ? this.leg.doneAt : this.clock);
    let pos = this.leg ? this.leg.to : this.pos;
    for (const stop of this.stops) {
      const order = orders.get(stop.orderId)!;
      const point = stop.kind === "PICKUP" ? order.pickup : order.dropoff;
      at += legSeconds(pos, point) * 1000;
      if (stop.kind === "DROPOFF" && order.windowStart !== null) at = Math.max(at, order.windowStart);
      at += STOP_SECONDS * 1000;
      pos = point;
    }
    return { at, pos };
  }

  advance(t: number, orders: Map<string, Order>, done: Map<string, number>) {
    for (;;) {
      if (this.leg) {
        if (this.leg.doneAt > t) return;
        const { stop, to, arriveAt } = this.leg;
        this.pos = to;
        this.clock = this.leg.doneAt;
        if (stop.kind === "PICKUP") {
          this.pickedUp.add(stop.orderId);
          this.onboard += 1;
        } else {
          this.onboard -= 1;
          this.delivered += 1;
          this.missions.delete(stop.orderId);
          this.pickedUp.delete(stop.orderId);
          done.set(stop.orderId, arriveAt);
        }
        this.leg = null;
      }
      const next = this.stops.shift();
      if (!next) {
        this.clock = Math.max(this.clock, t);
        return;
      }
      const order = orders.get(next.orderId)!;
      const to = next.kind === "PICKUP" ? order.pickup : order.dropoff;
      const departAt = Math.max(this.clock, DAY_START);
      let arriveAt = departAt + legSeconds(this.pos, to) * 1000;
      if (next.kind === "DROPOFF" && order.windowStart !== null) arriveAt = Math.max(arriveAt, order.windowStart);
      const km = legKm(this.pos, to);
      this.km += km;
      if (this.onboard === 0) this.emptyKm += km;
      this.leg = { stop: next, from: this.pos, to, departAt, arriveAt, doneAt: arriveAt + STOP_SECONDS * 1000 };
    }
  }

  assign(orderId: string) {
    this.missions.add(orderId);
    this.stops.push({ orderId, kind: "PICKUP" }, { orderId, kind: "DROPOFF" });
  }
}

type Picker = (ctx: {
  order: Order;
  t: number;
  drivers: Driver[];
  orders: Map<string, Order>;
  r: () => number;
  cap: number;
}) => string | null;

function settingsFor(strategy: "SCORE" | "LEAST_LOADED", cap: number): CompanyDispatchSettings {
  return companyDispatchSettingsSchema.parse({
    ...DEFAULT_DISPATCH_SETTINGS,
    enabled: true,
    strategy: strategy === "SCORE" ? "LEAST_LOADED" : strategy,
    bestScore: strategy === "SCORE",
    maxActiveDeliveriesPerDriver: cap,
    gpsProximityEnabled: true,
  });
}

/** Vrai code TutelLiv : mode Automatique. */
function appPicker(strategy: "SCORE" | "LEAST_LOADED", pickupKnown = true): Picker {
  return ({ order, t, drivers, orders, cap }) => {
    const settings = settingsFor(strategy, cap);
    const now = new Date(t);
    const activity = drivers.map((driver) => {
      const { assigned, inTransit } = driver.load();
      return {
        id: driver.id,
        firstName: driver.id,
        lastName: "",
        email: `${driver.id}@exemple.invalid`,
        phone: null,
        lastLoginAt: null,
        assigned,
        inTransit,
        deliveredToday: driver.delivered,
        activeByCategory: { STANDARD: assigned + inTransit },
      };
    });
    const proximities = new Map<string, DispatchProximity>();
    const travel = new Map<string, TravelEstimate>();
    const queues = new Map<string, DriverQueue>();
    // Comme `loadDriverQueues` : file estimée depuis la position, missions dans l'ordre reçu.
    const target = pickupKnown ? order.pickup : order.dropoff;
    for (const driver of drivers) {
      const position = driver.position(t);
      proximities.set(
        driver.id,
        computeDispatchProximity({ settings, pickup: target, onDuty: true, position: { ...position, updatedAt: now }, now })
      );
      const missions = [...driver.missions].map((id) => ({
        status: driver.pickedUp.has(id) ? "IN_DELIVERY" : "ASSIGNED",
        pickup: orders.get(id)!.pickup,
        destination: orders.get(id)!.dropoff,
      }));
      const queue = estimateDriverQueue(position, missions);
      queues.set(driver.id, queue);
      travel.set(driver.id, { source: "ROUTE", seconds: legSeconds(queue.end, target) });
    }
    const delivery = {
      id: order.id,
      driverId: null,
      status: "PENDING",
      createdAt: new Date(order.createdAt),
      deliveryCategory: "STANDARD" as const,
      postalCode: "13001",
      pickupPostalCode: "13001",
      pickupLatitude: pickupKnown ? order.pickup.latitude : null,
      pickupLongitude: pickupKnown ? order.pickup.longitude : null,
      latitude: order.dropoff.latitude,
      longitude: order.dropoff.longitude,
      order: { deliverySlotStart: order.windowStart === null ? null : new Date(order.windowStart) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forme minimale d'un livreur pour le calcul pur
    return resolveDriverForDelivery(delivery as any, settings, activity as any, [], proximities, travel, queues)?.driverId ?? null;
  };
}

const underCap = (drivers: Driver[], cap: number) => drivers.filter((driver) => driver.missions.size < cap);

const randomPicker: Picker = ({ drivers, r, cap }) => {
  const free = underCap(drivers, cap);
  return free.length ? free[Math.floor(r() * free.length)]!.id : null;
};

const nearestPicker: Picker = ({ order, t, drivers, cap }) => {
  const free = underCap(drivers, cap);
  free.sort((a, b) => legSeconds(a.position(t), order.pickup) - legSeconds(b.position(t), order.pickup) || a.id.localeCompare(b.id));
  return free[0]?.id ?? null;
};

/** Référence « dispatcher attentif » : celui qui aura livré le plus tôt, file comprise. */
const earliestPicker: Picker = ({ order, t, drivers, orders, cap }) => {
  let best: { id: string; at: number } | null = null;
  for (const driver of underCap(drivers, cap)) {
    const { at, pos } = driver.freeAtAndPos(t, orders);
    let done = at + legSeconds(pos, order.pickup) * 1000 + STOP_SECONDS * 1000 + legSeconds(order.pickup, order.dropoff) * 1000;
    if (order.windowStart !== null) done = Math.max(done, order.windowStart);
    if (!best || done < best.at) best = { id: driver.id, at: done };
  }
  return best?.id ?? null;
};

type Result = {
  delivered: number;
  total: number;
  late: number;
  lateMinutes: number;
  leadMinutes: number;
  km: number;
  emptyKm: number;
  spread: number;
  waitAssignMinutes: number;
};

function simulate(orders: Order[], driverCount: number, cap: number, seed: number, mode: Picker | "ROUNDS"): Result {
  const r = rng(seed * 7 + 1);
  const byId = new Map(orders.map((order) => [order.id, order]));
  const drivers = Array.from({ length: driverCount }, (_, i) => new Driver(`l${i + 1}`));
  const done = new Map<string, number>();
  const pending: Array<{ order: Order; nextTry: number }> = [];
  const assignedAt = new Map<string, number>();
  let cursor = 0;
  let nextRound = DAY_START;

  for (let t = DAY_START; t <= DAY_END; t += MIN) {
    for (const driver of drivers) driver.advance(t, byId, done);
    while (cursor < orders.length && orders[cursor]!.createdAt <= t) {
      pending.push({ order: orders[cursor]!, nextTry: orders[cursor]!.createdAt });
      cursor += 1;
    }
    if (mode === "ROUNDS") {
      if (t >= nextRound && pending.length > 0) {
        nextRound = t + ROUND_EVERY_MS;
        const deliveries: RoundDelivery[] = pending.map(({ order }) => ({
          id: order.id,
          destination: order.dropoff,
          pickup: order.pickup,
          weightKg: null,
          windowStart: order.windowStart,
          windowEnd: order.deadline,
          urgent: order.deadline < t,
        }));
        const ids = new Set(deliveries.map((delivery) => delivery.id));
        const roundDrivers: RoundDriver[] = drivers.map((driver) => {
          const { assigned, inTransit } = driver.load();
          return {
            id: driver.id,
            start: driver.position(t),
            // Comme l'appli : 15 min par mission déjà en cours.
            readyAt: t + (assigned + inTransit) * 15 * MIN,
            capacityKg: null,
            eligibleDeliveryIds: ids,
          };
        });
        const plan = planRounds(deliveries, roundDrivers, {
          now: t,
          stopSeconds: STOP_SECONDS,
          maxDaySeconds: 480 * 60,
          maxDeliveries: 12,
          travelSeconds: legSeconds,
        });
        for (const round of plan.rounds) {
          const driver = drivers.find((candidate) => candidate.id === round.driverId)!;
          const stops: RoundStop[] = round.evaluation.stops.map(({ deliveryId, kind }) => ({ deliveryId, kind }));
          for (const stop of stops) {
            driver.stops.push({ orderId: stop.deliveryId, kind: stop.kind });
            if (stop.kind === "PICKUP") {
              driver.missions.add(stop.deliveryId);
              assignedAt.set(stop.deliveryId, t);
            }
          }
        }
        const planned = new Set(plan.rounds.flatMap((round) => round.evaluation.stops.map((stop) => stop.deliveryId)));
        for (let i = pending.length - 1; i >= 0; i -= 1) if (planned.has(pending[i]!.order.id)) pending.splice(i, 1);
      }
    } else {
      for (let i = 0; i < pending.length; i += 1) {
        const item = pending[i]!;
        if (item.nextTry > t) continue;
        const driverId = mode({ order: item.order, t, drivers, orders: byId, r, cap });
        if (driverId) {
          drivers.find((driver) => driver.id === driverId)!.assign(item.order.id);
          assignedAt.set(item.order.id, t);
          pending.splice(i, 1);
          i -= 1;
        } else {
          item.nextTry = t + RETRY_MS;
        }
      }
    }
    for (const driver of drivers) driver.advance(t, byId, done);
  }

  let late = 0;
  let lateMinutes = 0;
  let leadMinutes = 0;
  let waitAssignMinutes = 0;
  for (const order of orders) {
    const at = done.get(order.id);
    const end = at ?? DAY_END;
    if (end > order.deadline) {
      late += 1;
      lateMinutes += (end - order.deadline) / MIN;
    }
    leadMinutes += (end - order.createdAt) / MIN;
    waitAssignMinutes += ((assignedAt.get(order.id) ?? DAY_END) - order.createdAt) / MIN;
  }
  const counts = drivers.map((driver) => driver.delivered);
  return {
    delivered: done.size,
    total: orders.length,
    late,
    lateMinutes,
    leadMinutes: leadMinutes / orders.length,
    km: drivers.reduce((sum, driver) => sum + driver.km, 0),
    emptyKm: drivers.reduce((sum, driver) => sum + driver.emptyKm, 0),
    spread: Math.max(...counts) - Math.min(...counts),
    waitAssignMinutes: waitAssignMinutes / orders.length,
  };
}

const STRATEGIES: Array<{ name: string; mode: Picker | "ROUNDS" }> = [
  { name: "Score (Dispatch intelligent, Automatique)", mode: appPicker("SCORE") },
  { name: "Score, adresse de retrait non saisie (cas des commandes de la démo)", mode: appPicker("SCORE", false) },
  { name: "Moins chargé (stratégie de base de l'appli)", mode: appPicker("LEAST_LOADED") },
  { name: "Tournées automatiques (Dispatch intelligent)", mode: "ROUNDS" },
  { name: "Référence : le plus proche, sans regarder la file", mode: nearestPicker },
  { name: "Référence : livré le plus tôt, file comprise", mode: earliestPicker },
  { name: "Référence : au hasard", mode: randomPicker },
];

const SCENARIOS = [
  { name: "Journée calme : 35 commandes, 5 livreurs, plafond 3 (réglage par défaut)", orders: 35, drivers: 5, cap: 3 },
  { name: "Journée chargée : 60 commandes, 5 livreurs, plafond 3 (réglage par défaut)", orders: 60, drivers: 5, cap: 3 },
  { name: "Journée chargée : 60 commandes, 5 livreurs, plafond 6", orders: 60, drivers: 5, cap: 6 },
  { name: "Journée très chargée : 80 commandes, 5 livreurs, plafond 6", orders: 80, drivers: 5, cap: 6 },
];

const seeds = Number(process.argv[2] ?? 30);
const fmt = (n: number, digits = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits });

console.log(`# Simulation du Dispatch intelligent — ${seeds} journées par scénario\n`);
console.log("Trajets à vol d'oiseau de l'appli (30 km/h, détour 40 %), 5 min par arrêt, Marseille, 6 points de retrait. Délai promis : 2 h après la commande, ou créneau de 2 h (30 % des commandes). Moyennes par journée.\n");
for (const scenario of SCENARIOS) {
  console.log(`## ${scenario.name}\n`);
  console.log("| Stratégie | En retard | Retard moyen des retards | Commande → livrée | Attente d'affectation | km | dont km à vide | Écart de livraisons entre livreurs | Non livrées à 21 h |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const strategy of STRATEGIES) {
    const sum = { late: 0, lateMinutes: 0, lead: 0, km: 0, empty: 0, spread: 0, undelivered: 0, total: 0, wait: 0 };
    for (let seed = 1; seed <= seeds; seed += 1) {
      const result = simulate(makeDay(seed * 101 + scenario.orders, scenario.orders), scenario.drivers, scenario.cap, seed, strategy.mode);
      sum.late += result.late;
      sum.lateMinutes += result.lateMinutes;
      sum.lead += result.leadMinutes;
      sum.km += result.km;
      sum.empty += result.emptyKm;
      sum.spread += result.spread;
      sum.undelivered += result.total - result.delivered;
      sum.total += result.total;
      sum.wait += result.waitAssignMinutes;
    }
    const latePct = (100 * sum.late) / sum.total;
    console.log(
      `| ${strategy.name} | ${fmt(latePct, 1)} % | ${sum.late ? fmt(sum.lateMinutes / sum.late) : "0"} min | ${fmt(sum.lead / seeds)} min | ${fmt(sum.wait / seeds)} min | ${fmt(sum.km / seeds)} | ${fmt(sum.empty / seeds)} | ${fmt(sum.spread / seeds, 1)} | ${fmt(sum.undelivered / seeds, 1)} |`
    );
  }
  console.log("");
}
