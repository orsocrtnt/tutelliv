"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listMissions, listBeneficiaries } from "@/lib/api";
import type { Mission, Beneficiary } from "@/lib/types";

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
    pending: { label: "En attente", className: "bg-yellow-100 text-yellow-800 ring-yellow-600/20" },
    in_progress: { label: "En cours", className: "bg-blue-100 text-blue-800 ring-blue-600/20" },
    delivered: { label: "Livrée", className: "bg-green-100 text-green-800 ring-green-600/20" },
    canceled: { label: "Annulée", className: "bg-red-100 text-red-800 ring-red-600/20" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-800 ring-gray-600/20" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

export default function MissionsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const [ms, bs] = await Promise.all([listMissions(), listBeneficiaries()]);
        setMissions(ms);
        setBeneficiaries(bs);
      } catch (e: any) {
        setErr(e?.message || "Erreur lors du chargement");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const beneMap = useMemo(() => {
    const map = new Map<number, Beneficiary>();
    for (const b of beneficiaries) map.set(Number(b.id), b);
    return map;
  }, [beneficiaries]);

  const renderCategories = (m: Mission) => {
    const cats = (m.categories && m.categories.length > 0)
      ? m.categories
      : (m.category ? [m.category] : []);
    if (!cats || cats.length === 0) return "—";
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
        <h1 className="text-2xl font-semibold">Missions</h1>
        <Link href="/missions/new" className="btn btn-primary">
          Nouvelle mission
        </Link>
      </div>

      {loading && (
        <div className="card"><div className="card-body">Chargement…</div></div>
      )}
      {err && (
        <div className="card"><div className="card-body text-red-600">{err}</div></div>
      )}

      {!loading && !err && (
        <div className="card">
          <div className="card-body">
            {missions.length === 0 ? (
              <div className="text-gray-500">Aucune mission.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2">Protégé</th>
                    <th className="py-2">Catégories</th>
                    <th className="py-2">Statut</th>
                    <th className="py-2">Commentaire</th>
                    <th className="py-2">Créée le</th>
                    <th className="py-2">ID</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {missions.map((m) => {
                    const b = beneMap.get(Number(m.beneficiary_id));
                    const who = b ? `${b.last_name} ${b.first_name}` : m.beneficiary_id;
                    const idShort = m.id.length > 8 ? `${m.id.slice(0, 8)}…` : m.id;
                    const created = m.created_at ? new Date(m.created_at).toLocaleDateString("fr-FR") : "-";
                    const canEdit = m.status === "pending";
                    return (
                      <tr key={m.id} className="border-t">
                        <td className="py-2">{who}</td>
                        <td className="py-2">{renderCategories(m)}</td>
                        <td className="py-2"><StatusBadge status={m.status} /></td>
                        <td className="py-2">{m.comment?.trim() || m.general_comment?.trim() || "—"}</td>
                        <td className="py-2">{created}</td>
                        <td className="py-2 font-mono">{idShort}</td>
                        <td className="py-2">
                          {canEdit ? (
                            <Link
                              href={`/missions/${m.id}/edit`}
                              className="px-3 py-1 rounded-md border hover:bg-gray-50"
                            >
                              Modifier
                            </Link>
                          ) : (
                            <button className="px-3 py-1 rounded-md border text-gray-400 cursor-not-allowed" disabled>
                              Modifier
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
