"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getMission, updateMission } from "@/lib/api";
import type { Mission } from "@/lib/types";

const CAT_FR: Record<string, string> = {
  FOOD: "Alimentaire",
  HYGIENE: "Hygiène",
  TOBACCO_MANDATE: "Tabac (mandat)",
  CASH_DELIVERY: "Livraison espèces",
  OTHER: "Autre",
};

const ALL_CATS = Object.keys(CAT_FR) as (keyof typeof CAT_FR)[];

export default function EditMissionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [mission, setMission] = useState<Mission | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [commentsByCat, setCommentsByCat] = useState<Record<string, string>>({});
  const [generalComment, setGeneralComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const m = await getMission(params.id);
        setMission(m);
        const initChecked: Record<string, boolean> = {};
        (m.categories?.length ? m.categories : (m.category ? [m.category] : [])).forEach((c) => (initChecked[c] = true));
        setChecked(initChecked);
        setCommentsByCat(m.comments_by_category || {});
        setGeneralComment(m.general_comment || m.comment || "");
      } catch (e: any) {
        setErr(e?.message ?? "Erreur de chargement");
      }
    })();
  }, [params.id]);

  const selectedCategories = useMemo(
    () => Object.entries(checked).filter(([, v]) => v).map(([k]) => k),
    [checked]
  );

  const canEdit = mission?.status === "pending";

  function toggle(c: string) {
    setChecked((prev) => {
      const next = { ...prev, [c]: !prev[c] };
      if (!next[c]) {
        setCommentsByCat((p) => {
          const cp = { ...p };
          delete cp[c];
          return cp;
        });
      }
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mission) return;
    if (!canEdit) {
      setErr("Seules les missions en attente peuvent être modifiées.");
      return;
    }
    if (selectedCategories.length === 0) {
      setErr("Choisis au moins une catégorie.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await updateMission(mission.id, {
        beneficiary_id: mission.beneficiary_id,
        categories: selectedCategories,
        comments_by_category: commentsByCat,
        general_comment: generalComment.trim() || null,
      });
      router.push("/missions");
    } catch (e: any) {
      setErr(e?.message ?? "Erreur lors de l’enregistrement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Modifier la mission</h1>
        <Link href="/missions" className="btn btn-secondary">Retour</Link>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{err}</div>}

      {!mission ? (
        <div className="card"><div className="card-body">Chargement…</div></div>
      ) : (
        <form onSubmit={onSubmit} className="card">
          <div className="card-body space-y-6">
            <div className="text-sm text-gray-500">
              Bénéficiaire ID&nbsp;: <span className="font-mono">{mission.beneficiary_id}</span> · Statut : <strong>{mission.status}</strong>
            </div>

            <div className="space-y-3">
              <label className="label">Catégories</label>
              <div className="space-y-3">
                {ALL_CATS.map((c) => (
                  <div key={c} className="rounded-md border p-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!checked[c]} onChange={() => toggle(c)} disabled={!canEdit} />
                      <span className="font-medium">{CAT_FR[c]}</span>
                    </label>
                    {checked[c] && (
                      <div className="mt-2">
                        <label className="text-xs text-gray-500">Commentaire ({CAT_FR[c]})</label>
                        <textarea
                          className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[70px]"
                          placeholder={`Détails pour ${CAT_FR[c]}…`}
                          value={commentsByCat[c] || ""}
                          onChange={(e) => setCommentsByCat((p) => ({ ...p, [c]: e.target.value }))}
                          disabled={!canEdit}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Commentaire (commande) — optionnel</label>
              <textarea
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[90px]"
                value={generalComment}
                onChange={(e) => setGeneralComment(e.target.value)}
                disabled={!canEdit}
              />
            </div>

            <div className="flex gap-3">
              <button className="btn btn-primary" disabled={!canEdit || busy}>
                {busy ? "Enregistrement…" : "Enregistrer"}
              </button>
              <Link href="/missions" className="btn btn-secondary">Annuler</Link>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
