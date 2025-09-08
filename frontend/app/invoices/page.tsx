"use client";

import { useEffect, useMemo, useState } from "react";
import { listInvoices, listMissions, listBeneficiaries, getInvoicePdfUrl } from "@/lib/api"; // ✅ getInvoicePdfUrl
import type { Invoice, Mission, Beneficiary } from "@/lib/types";

// Catégories -> libellés FR
const CAT_FR: Record<string, string> = {
  FOOD: "Alimentaire",
  HYGIENE: "Hygiène",
  TOBACCO_MANDATE: "Tabac (mandat)",
  CASH_DELIVERY: "Livraison espèces",
  OTHER: "Autre",
};

// Badge statut FR + couleur
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    editing: { label: "En cours d'édition", className: "bg-yellow-100 text-yellow-800 ring-yellow-600/20" },
    pending: { label: "À régler", className: "bg-blue-100 text-blue-800 ring-blue-600/20" },
    paid:    { label: "Réglée",  className: "bg-green-100 text-green-800 ring-green-600/20" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-800 ring-gray-600/20" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const [inv, ms, bs] = await Promise.all([
        listInvoices(),
        listMissions(),
        listBeneficiaries(),
      ]);
      setInvoices(inv);
      setMissions(ms);
      setBeneficiaries(bs);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur lors du chargement des factures");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setInterval> | null = null;

    (async () => {
      if (!alive) return;
      await refresh();
      // polling toutes les 10s
      t = setInterval(refresh, 10000);
    })();

    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, []);

  const missionMap = useMemo(() => {
    const m = new Map<string, Mission>();
    missions.forEach((mi) => m.set(mi.id, mi));
    return m;
  }, [missions]);

  const beneMap = useMemo(() => {
    const m = new Map<number, Beneficiary>();
    beneficiaries.forEach((b) => m.set(Number(b.id), b));
    return m;
  }, [beneficiaries]);

  const renderCategories = (mission: Mission | undefined) => {
    if (!mission) return "—";
    const cats = mission.categories?.length ? mission.categories : (mission.category ? [mission.category] : []);
    if (!cats.length) return "—";
    return (
      <div className="flex flex-wrap gap-1">
        {cats.map((c) => (
          <span key={c} className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs">
            {CAT_FR[c] ?? c}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Factures</h1>
        <button onClick={refresh} className="btn btn-secondary">Rafraîchir</button>
      </div>

      {loading && (
        <div className="card"><div className="card-body">Chargement…</div></div>
      )}
      {err && (
        <div className="card"><div className="card-body text-red-600">{err}</div></div>
      )}

      {!loading && !err && (
        <div className="card">
          <div className="card-body overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2">Protégé</th>
                  <th className="py-2">Catégories</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Montant</th>
                  <th className="py-2">Statut</th>
                  <th className="py-2">Actions</th> {/* ✅ NEW */}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-500">
                      Aucune facture trouvée.
                    </td>
                  </tr>
                ) : (
                  invoices
                    .slice()
                    .sort((a, b) =>
                      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
                    )
                    .map((inv) => {
                      const mission = missionMap.get(inv.mission_id);
                      const bene = mission ? beneMap.get(Number(mission.beneficiary_id)) : undefined;
                      const who = bene ? `${bene.last_name} ${bene.first_name}` : "—";
                      const date = inv.created_at ? new Date(inv.created_at).toLocaleDateString("fr-FR") : "—";
                      const amount = (inv.amount ?? 0).toFixed(2) + " €";
                      return (
                        <tr key={inv.id} className="border-t">
                          <td className="py-2">{who}</td>
                          <td className="py-2">{renderCategories(mission)}</td>
                          <td className="py-2">{date}</td>
                          <td className="py-2">{amount}</td>
                          <td className="py-2"><StatusBadge status={inv.status} /></td>
                          <td className="py-2">
                            {/* ✅ Lien direct vers le PDF (auth via cookie fallback côté back) */}
                            <a
                              className="btn btn-secondary"
                              href={getInvoicePdfUrl(inv.id)}
                              target="_blank"
                            >
                              Télécharger
                            </a>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
