"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { listBeneficiaries, createMission } from "@/lib/api";
import type { Beneficiary } from "@/lib/types";

type MissionCategory =
  | "FOOD"
  | "HYGIENE"
  | "TOBACCO_MANDATE"
  | "CASH_DELIVERY"
  | "OTHER";

const CATEGORY_LABEL: Record<MissionCategory, string> = {
  FOOD: "Alimentaire",
  HYGIENE: "Hygiène",
  TOBACCO_MANDATE: "Tabac (mandat)",
  CASH_DELIVERY: "Livraison espèces",
  OTHER: "Autre",
};

export default function NewMissionPage() {
  const router = useRouter();

  // ------ Données protégés + recherche ------
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<Beneficiary | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ------ Formulaire mission (nouveau modèle) ------
  const [checked, setChecked] = useState<Record<MissionCategory, boolean>>({
    FOOD: false,
    HYGIENE: false,
    TOBACCO_MANDATE: false,
    CASH_DELIVERY: false,
    OTHER: false,
  });
  const [commentsByCat, setCommentsByCat] = useState<
    Partial<Record<MissionCategory, string>>
  >({});
  const [generalComment, setGeneralComment] = useState("");

  // ------ États UI ------
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 1) Charger les protégés au montage
  useEffect(() => {
    listBeneficiaries()
      .then(setBeneficiaries)
      .catch((e) =>
        setErr(e?.message || "Erreur lors du chargement des protégés"),
      );
  }, []);

  // 2) Filtrage client (nom + adresse), top 8 résultats
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = beneficiaries ?? [];
    if (!q) return pool.slice(0, 8);
    return pool
      .filter((b) => {
        const hay = `${b.last_name} ${b.first_name} ${b.address ?? ""} ${
          b.city ?? ""
        } ${b.postal_code ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [query, beneficiaries]);

  // 3) Choix d’un protégé
  function choose(b: Beneficiary) {
    setSelected(b);
    setQuery(`${b.last_name} ${b.first_name}`);
    setDropdownOpen(false);
  }

  // Navigation clavier pour l’auto-complétion
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) choose(filtered[highlight]);
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
    }
  }

  // Gestion checkboxes
  function toggleCategory(cat: MissionCategory) {
    setChecked((c) => {
      const next = { ...c, [cat]: !c[cat] };
      // Si on décoche, on nettoie le commentaire de la catégorie
      if (!next[cat]) {
        setCommentsByCat((prev) => {
          const cp = { ...prev };
          delete cp[cat];
          return cp;
        });
      }
      return next;
    });
  }

  const selectedCategories = useMemo<MissionCategory[]>(
    () => (Object.keys(checked) as MissionCategory[]).filter((k) => checked[k]),
    [checked],
  );

  // Soumission
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!selected) {
      setErr("Veuillez sélectionner un protégé.");
      inputRef.current?.focus();
      return;
    }
    if (selectedCategories.length === 0) {
      setErr("Veuillez choisir au moins une catégorie.");
      return;
    }

    setBusy(true);
    try {
      await createMission({
        beneficiary_id: Number(selected.id),
        categories: selectedCategories,
        comments_by_category: commentsByCat,
        general_comment: generalComment.trim() || null,
        status: "pending",
      } as any);

      router.push("/missions");
    } catch (e: any) {
      setErr(e?.message || "Erreur lors de la création de la mission");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nouvelle mission</h1>
        <Link href="/missions" className="btn btn-secondary">
          Retour
        </Link>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      <form onSubmit={onSubmit} className="card">
        <div className="card-body space-y-6">
          {/* ------- Sélecteur Protégé ------- */}
          <div className="relative">
            <label className="label">Protégé</label>
            <input
              ref={inputRef}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Tapez le nom (ex : Dupont)…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
                setDropdownOpen(true);
                setHighlight(0);
              }}
              onFocus={() => setDropdownOpen(true)}
              onKeyDown={onKeyDown}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 120)}
            />
            <div className="text-xs text-gray-500 mt-1">
              {selected ? `ID sélectionné : ${selected.id}` : "Aucun protégé sélectionné"}
            </div>

            {dropdownOpen && filtered.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border rounded-md shadow max-h-60 overflow-auto">
                {filtered.map((b, idx) => (
                  <button
                    type="button"
                    key={b.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(b)}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${
                      idx === highlight ? "bg-gray-50" : ""
                    }`}
                  >
                    <div className="font-medium">
                      {b.last_name} {b.first_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      ID: {b.id} — {b.address ?? ""}
                      {b.address ? ", " : ""}
                      {b.city ?? ""} {b.postal_code ?? ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ------- Catégories + commentaires par catégorie ------- */}
          <div className="space-y-3">
            <label className="label">Catégories</label>

            <div className="space-y-3">
              {(Object.keys(CATEGORY_LABEL) as MissionCategory[]).map((cat) => (
                <div key={cat} className="rounded-md border p-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!checked[cat]}
                      onChange={() => toggleCategory(cat)}
                    />
                    <span className="font-medium">{CATEGORY_LABEL[cat]}</span>
                  </label>

                  {checked[cat] && (
                    <div className="mt-2">
                      <label className="text-xs text-gray-500">Commentaire ({CATEGORY_LABEL[cat]})</label>
                      <textarea
                        className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[70px]"
                        placeholder={`Détails pour ${CATEGORY_LABEL[cat]}…`}
                        value={commentsByCat[cat] || ""}
                        onChange={(e) =>
                          setCommentsByCat((prev) => ({ ...prev, [cat]: e.target.value }))
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ------- Commentaire général (optionnel) ------- */}
          <div>
            <div className="flex items-center justify-between">
              <label className="label">Commentaire (commande) — optionnel</label>
            </div>
            <textarea
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[90px]"
              placeholder="Informations générales sur la commande…"
              value={generalComment}
              onChange={(e) => setGeneralComment(e.target.value)}
            />
          </div>

          {/* ------- Actions ------- */}
          <div className="flex gap-3">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Création…" : "Créer la mission"}
            </button>
            <Link href="/missions" className="btn btn-secondary">
              Annuler
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
