// frontend/components/Header.tsx
"use client";

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Helper : lit le rôle depuis le cookie
function getRoleFromCookie(): "mjpm" | "deliverer" | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)tutelliv_role=([^;]+)/);
  return (m?.[1] as any) ?? null;
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();

  // ❌ Masquer totalement le header sur /login
  if (pathname?.startsWith("/login")) return null;

  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"mjpm" | "deliverer" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const logout = () => {
    // purge auth
    document.cookie =
      "tutelliv_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie =
      "tutelliv_role=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    try {
      localStorage.removeItem("tutelliv_token");
    } catch {}
    router.push("/login");
  };

  // Récupère le rôle et ferme le menu à chaque navigation
  useEffect(() => {
    setRole(getRoleFromCookie());
    setOpen(false);
  }, [pathname]);

  // Fermer le menu au clic extérieur
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!menuRef.current || !buttonRef.current) return;
      const target = e.target as Node;
      if (
        !menuRef.current.contains(target) &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // === Rendu mobile uniquement (md:hidden) ===
  // Pour deliverer → pas de dropdown (juste une barre avec lien vers dashboard livreur)
  if (role === "deliverer") {
    return (
      <div className="md:hidden p-3 border-b bg-white sticky top-0 z-40 flex justify-between items-center">
        <div className="font-bold text-lg">
          <Link href="/courier/dashboard">TutelLiv</Link>
        </div>
        {/* Pas de burger/menu pour le livreur */}
      </div>
    );
  }

  // Par défaut (MJPM & autres rôles) → header mobile avec burger + dropdown
  return (
    <div className="md:hidden p-3 border-b bg-white sticky top-0 z-40 flex justify-between items-center">
      <div className="font-bold text-lg">Menu</div>

      <div className="relative" ref={menuRef}>
        <button
          ref={buttonRef}
          aria-label="Ouvrir le menu"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex flex-col items-center justify-center rounded-md border px-3 py-2"
          type="button"
        >
          <span className="block w-5 h-0.5 bg-gray-800" />
          <span className="block w-5 h-0.5 bg-gray-800 mt-1" />
          <span className="block w-5 h-0.5 bg-gray-800 mt-1" />
        </button>

        {open && (
          <div
            className="absolute right-0 mt-2 w-48 rounded-lg border bg-white shadow-lg overflow-hidden"
            role="menu"
          >
            <Link
              href="/dashboard"
              className="block px-3 py-2 hover:bg-gray-100"
              onClick={() => setOpen(false)}
            >
              Tableau de bord
            </Link>
            <Link
              href="/missions"
              className="block px-3 py-2 hover:bg-gray-100"
              onClick={() => setOpen(false)}
            >
              Missions
            </Link>
            <Link
              href="/invoices"
              className="block px-3 py-2 hover:bg-gray-100"
              onClick={() => setOpen(false)}
            >
              Factures
            </Link>
            <Link
              href="/beneficiaires"
              className="block px-3 py-2 hover:bg-gray-100"
              onClick={() => setOpen(false)}
            >
              Protégés
            </Link>
            <button
              onClick={logout}
              className="w-full text-left px-3 py-2 bg-red-600 text-white hover:bg-red-700"
              type="button"
            >
              Déconnexion
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
