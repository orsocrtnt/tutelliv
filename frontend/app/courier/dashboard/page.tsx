// frontend/app/courier/dashboard/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  listMissions,
  listBeneficiaries,
  acceptMission,
  deliverMission,
  findInvoiceIdByMission,
  setInvoiceDetailedAndPending,
} from "@/lib/api";
import type { Mission, Beneficiary } from "@/lib/types";
import MissionsCalendar from "@/components/MissionsCalendar"; // ✅ calendrier
import { connectEvents } from "@/lib/realtime"; // ✅ SSE

// Libellés FR
const CAT_FR: Record<string, string> = {
  FOOD: "Alimentaire",
  HYGIENE: "Hygiène",
  TOBACCO_MANDATE: "Tabac (mandat)",
  CASH_DELIVERY: "Livraison espèces",
  OTHER: "Autre",
};

const STATUS_FR: Record<string, string> = {
  pending: "En attente",
  in_progress: "En cours",
  delivered: "Livrée",
};

function StatusBadge({ status }: { status: string }) {
  const cfg =
    status === "pending"
      ? "bg-yellow-100 text-yellow-800 ring-yellow-600/20"
      : status === "in_progress"
      ? "bg-blue-100 text-blue-800 ring-blue-600/20"
      : status === "delivered"
      ? "bg-green-100 text-green-800 ring-green-600/20"
      : "bg-gray-100 text-gray-800 ring-gray-600/20";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${cfg}`}>
      {STATUS_FR[status] ?? status}
    </span>
  );
}

type TabKey = "pending" | "in_progress" | "delivered";

// Types locaux pour la modale facture
type LineDraft = { price: string; note: string };

export default function CourierDashboardPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [tab, setTab] = useState<TabKey>("pending");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // --- État modale facture ---
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMission, setModalMission] = useState<Mission | null>(null);
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const [deliveryFee, setDeliveryFee] = useState<string>("38"); // prérempli à 38 €
  const [noteGlobal, setNoteGlobal] = useState<string>("");

  // Chargement initial + abonnement SSE
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    async function load() {
      try {
        setErr(null);
        setLoading(true);
        const [ms, bs] = await Promise.all([listMissions(), listBeneficiaries()]);
        if (!mounted) return;
        setMissions(ms);
        setBeneficiaries(bs);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? "Erreur lors du chargement");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    load();

    // ✅ Abonnement SSE : recharge sur chaque changement mission/facture
    unsubscribe = connectEvents((msg) => {
      if (
        msg.type === "mission.created" ||
        msg.type === "mission.updated" ||
        msg.type === "mission.deleted" ||
        msg.type === "invoice.updated"
      ) {
        load();
      }
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const refresh = async () => {
    try {
      setErr(null);
      setLoading(true);
      const [ms, bs] = await Promise.all([listMissions(), listBeneficiaries()]);
      setMissions(ms);
      setBeneficiaries(bs);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur lors du rafraîchissement");
    } finally {
      setLoading(false);
    }
  };

  const beneMap = useMemo(() => {
    const m = new Map<number, Beneficiary>();
    beneficiaries.forEach((b) => m.set(Number(b.id), b));
    return m;
  }, [beneficiaries]);

  const byTab = useMemo(() => {
    const group: Record<TabKey, Mission[]> = {
      pending: [],
      in_progress: [],
      delivered: [],
    };
    missions.forEach((m) => {
      const s = (m.status as TabKey) || "pending";
      if (s in group) group[s].push(m);
    });
    (Object.keys(group) as TabKey[]).forEach((k) =>
      group[k].sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      )
    );
    return group;
  }, [missions]);

  // Actions
  async function onAccept(m: Mission) {
    setBusyId(m.id);
    try {
      await acceptMission(m);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Impossible d’accepter la mission");
    } finally {
      setBusyId(null);
    }
  }

  // Ouvre la modale facture enrichie
  function openInvoiceModal(m: Mission) {
    setModalMission(m);

    const cats = m.categories?.length ? m.categories : m.category ? [m.category] : [];
    const preNotes = m.comments_by_category || {};

    const init: Record<string, LineDraft> = {};
    cats.forEach((c) => {
      init[c] = {
        price: "",
        note: preNotes[c] ?? "",
      };
    });

    setLines(init);
    setDeliveryFee("38");
    setNoteGlobal("");
    setModalOpen(true);
  }

  // Total calculé
  const total = useMemo(() => {
    const sumLines = Object.values(lines).reduce((acc, l) => {
      const n = Number.parseFloat((l.price || "").replace(",", "."));
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    const fee = Number.parseFloat((deliveryFee || "").replace(",", "."));
    return sumLines + (Number.isFinite(fee) ? fee : 0);
  }, [lines, deliveryFee]);

  // Confirme livraison + envoie facture détaillée
  async function confirmDeliveredWithInvoice() {
    if (!modalMission) return;
    const m = modalMission;

    // Validation légère
    const parsedLines: Record<string, { amount: number; note?: string }> = {};
    for (const [cat, l] of Object.entries(lines)) {
      const n = Number.parseFloat((l.price || "").replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        setErr(`Le montant pour “${CAT_FR[cat] ?? cat}” doit être un nombre positif.`);
        return;
      }
      parsedLines[cat] = { amount: Number(n.toFixed(2)), note: (l.note || "").trim() || undefined };
    }
    const fee = Number.parseFloat((deliveryFee || "").replace(",", "."));
    if (!Number.isFinite(fee) || fee < 0) {
      setErr("Le frais de livraison doit être un nombre positif.");
      return;
    }
    const grandTotal = Number((Object.values(parsedLines).reduce((a, x) => a + x.amount, 0) + fee).toFixed(2));

    setBusyId(m.id);
    try {
      await deliverMission(m);
      const invId = await findInvoiceIdByMission(m.id);
      if (invId) {
        await setInvoiceDetailedAndPending(invId, {
          lines_by_category: parsedLines,
          delivery_fee: Number(fee.toFixed(2)),
          amount: grandTotal,
          note: noteGlobal.trim() || null,
        });
      }
      setModalOpen(false);
      setModalMission(null);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Impossible d’enregistrer la facture");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* --- Header / actions --- */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tableau de bord Livreur</h1>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="btn btn-secondary">Rafraîchir</button>
        </div>
      </div>

      {/* --- Tabs --- */}
      <div className="flex gap-2">
        {([
          ["pending", "En attente"],
          ["in_progress", "En cours"],
          ["delivered", "Livrées"],
        ] as [TabKey, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded border text-sm ${
              tab === k ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-gray-50"
            }`}
          >
            {label} <span className="opacity-60">({byTab[k].length})</span>
          </button>
        ))}
      </div>

      {/* --- Erreurs --- */}
      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          {err}
        </div>
      )}

      {/* --- Vos widgets existants (listes par statut, actions, etc.) --- */}
      <div className="space-y-3">
        {loading ? (
          <div className="card"><div className="card-body">Chargement…</div></div>
        ) : byTab[tab].length === 0 ? (
          <div className="text-gray-500">Aucune mission.</div>
        ) : (
          byTab[tab].map((m) => {
            const bene = beneMap.get(Number(m.beneficiary_id));
            const who = bene ? `${bene.last_name?.toUpperCase?.() ?? bene.last_name} ${bene.first_name}` : `#${m.beneficiary_id}`;
            const created = m.created_at
              ? new Date(m.created_at).toLocaleString("fr-FR")
              : "-";
            const cats = m.categories?.length
              ? m.categories
              : m.category
              ? [m.category]
              : [];
            const comments = m.comments_by_category || {};
            const general = m.general_comment || m.comment || null;

            const mapsHref = bene?.address
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${bene.address} ${bene.postal_code ?? ""} ${bene.city ?? ""}`
                )}`
              : null;

            const beneId = String(bene?.id ?? m.beneficiary_id);

            return (
              <div
                key={m.id}
                className="border rounded-lg bg-white p-4 shadow-sm flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* 👉 Nom cliquable vers le profil du protégé */}
                    <Link
                      href={`/beneficiaires/${beneId}`}
                      className="font-semibold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-0.5"
                      title="Ouvrir le profil du protégé"
                    >
                      {who}
                    </Link>
                    <StatusBadge status={m.status} />

                    {/* 👉 Bouton explicite “Voir le profil” */}
                    <Link
                      href={`/beneficiaires/${beneId}`}
                      className="ml-2 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-1"
                    >
                      Voir le profil <span aria-hidden>↗</span>
                      <span className="sr-only">Voir le profil du protégé</span>
                    </Link>
                  </div>

                  {bene?.address && (
                    <div className="text-sm text-gray-600">
                      {bene.address}
                      {bene.postal_code ? `, ${bene.postal_code}` : ""}{" "}
                      {bene.city ?? ""}
                      {mapsHref && (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={mapsHref}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:no-underline"
                          >
                            Itinéraire
                          </a>
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1">
                    {cats.map((c) => (
                      <span
                        key={c}
                        className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs"
                      >
                        {CAT_FR[c] ?? c}
                      </span>
                    ))}
                  </div>

                  {cats.some((c) => comments[c]) && (
                    <div className="text-xs text-gray-600">
                      {cats.map(
                        (c) =>
                          comments[c] && (
                            <div key={c}>
                              <span className="font-medium">{CAT_FR[c] ?? c} :</span>{" "}
                              {comments[c]}
                            </div>
                          )
                      )}
                    </div>
                  )}

                  {general && (
                    <div className="text-sm">
                      <span className="text-gray-500">Note :</span> {general}
                    </div>
                  )}

                  <div className="text-xs text-gray-400">Créée le {created}</div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 md:pt-1">
                  {m.status === "pending" && (
                    <button
                      disabled={busyId === m.id}
                      onClick={() => onAccept(m)}
                      className="btn btn-primary"
                    >
                      {busyId === m.id ? "…" : "Accepter"}
                    </button>
                  )}
                  {m.status === "in_progress" && (
                    <button
                      disabled={busyId === m.id}
                      onClick={() => openInvoiceModal(m)}
                      className="btn btn-secondary"
                    >
                      {busyId === m.id ? "…" : "Marquer livrée"}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* --- Calendrier des missions (AJOUT, en dessous des widgets) --- */}
      {!loading && !err && (
        <MissionsCalendar
          missions={missions}
          beneficiaries={beneficiaries}
          role="deliverer"
        />
      )}

      {/* --- Modale facture détaillée --- */}
      {modalOpen && modalMission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-2xl rounded-lg border bg-white shadow-lg">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">Créer la facture</h2>
              <p className="text-xs text-gray-500">
                Renseigne les montants d’achat par catégorie, ajuste les commentaires si besoin, puis valide.
                Les frais de livraison sont préremplis à 38&nbsp;€.
              </p>
            </div>

            <div className="p-4 space-y-4">
              {/* Tableau lignes */}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-2 w-40">Catégorie</th>
                      <th className="py-2">Commentaire</th>
                      <th className="py-2 w-40">Montant (€)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(lines).map(([cat, draft]) => (
                      <tr key={cat} className="border-t align-top">
                        <td className="py-2 pr-3 font-medium">{CAT_FR[cat] ?? cat}</td>
                        <td className="py-2 pr-3">
                          <textarea
                            className="input min-h-[70px] w-full"
                            value={draft.note}
                            onChange={(e) =>
                              setLines((prev) => ({
                                ...prev,
                                [cat]: { ...prev[cat], note: e.target.value },
                              }))
                            }
                            placeholder={`Détail ${CAT_FR[cat] ?? cat}…`}
                          />
                        </td>
                        <td className="py-2">
                          <input
                            className="input w-full"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={draft.price}
                            onChange={(e) =>
                              setLines((prev) => ({
                                ...prev,
                                [cat]: { ...prev[cat], price: e.target.value },
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Frais de livraison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Frais de livraison (€)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Prérempli à 38 € (modifiable).
                  </p>
                </div>
                <div>
                  <label className="label">Note globale (optionnelle)</label>
                  <textarea
                    className="input min-h-[70px]"
                    placeholder="Infos complémentaires, ticket, etc."
                    value={noteGlobal}
                    onChange={(e) => setNoteGlobal(e.target.value)}
                  />
                </div>
              </div>

              {/* Total */}
              <div className="flex items-center justify-end">
                <div className="text-right">
                  <div className="text-sm text-gray-500">Total</div>
                  <div className="text-2xl font-semibold">{total.toFixed(2)} €</div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setModalOpen(false);
                  setModalMission(null);
                }}
              >
                Annuler
              </button>
              <button className="btn btn-primary" onClick={confirmDeliveredWithInvoice}>
                Valider & envoyer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
