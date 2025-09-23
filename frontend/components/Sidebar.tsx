"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function getRoleFromCookie(): "mjpm" | "deliverer" | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)tutelliv_role=([^;]+)/);
  return (m?.[1] as any) ?? null;
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<"mjpm" | "deliverer" | null>(null);

  useEffect(() => {
    setRole(getRoleFromCookie());
  }, [pathname]);

  // Ne pas afficher la sidebar sur /login
  if (pathname?.startsWith("/login")) return null;

  const logout = () => {
    document.cookie = "tutelliv_token=; path=/; max-age=0";
    document.cookie = "tutelliv_role=; path=/; max-age=0";
    localStorage.removeItem("tutelliv_token");
    router.push("/login");
  };

  const LinkItem = ({ href, children }: { href: string; children: React.ReactNode }) => {
    const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
    return (
      <Link
        className={`block px-3 py-2 rounded hover:bg-gray-100 ${
          active ? "bg-gray-100 font-medium" : ""
        }`}
        href={href}
      >
        {children}
      </Link>
    );
  };

  return (
    // ✅ Sidebar visible seulement ≥ md (sur mobile, on utilise le menu burger du Header)
    <aside className="w-64 bg-white border-r p-5 hidden md:block">
      <div className="text-xl font-bold mb-6">
        <Link href={role === "deliverer" ? "/courier/dashboard" : "/dashboard"}>TutelLiv</Link>
      </div>

      {/* Espace MJPM */}
      {role !== "deliverer" && (
        <nav className="space-y-2">
          <LinkItem href="/dashboard">Tableau de bord</LinkItem>
          <LinkItem href="/missions">Missions</LinkItem>
          <LinkItem href="/beneficiaires">Protégés</LinkItem>
          <LinkItem href="/invoices">Factures</LinkItem>
          <LinkItem href="/settings">Paramètres</LinkItem>
        </nav>
      )}

      {/* Espace Livreur */}
      {role === "deliverer" && (
        <nav className="space-y-2">
          <LinkItem href="/courier/dashboard">Tableau livreur</LinkItem>
        </nav>
      )}

      <div className="mt-6">
        <button
          onClick={logout}
          className="w-full bg-red-600 text-white px-3 py-2 rounded hover:bg-red-700 transition"
        >
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
