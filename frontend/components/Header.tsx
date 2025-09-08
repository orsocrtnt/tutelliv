"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import React from "react";

const Header: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();

  // Ne pas afficher le header sur la page de login
  if (pathname?.startsWith("/login")) return null;

  const logout = () => {
    document.cookie =
      "tutelliv_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    localStorage.removeItem("tutelliv_token");
    router.push("/login");
  };

  return (
    <header className="bg-white border-b px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-40">
      <h1 className="text-lg md:text-xl font-bold">
        <Link href="/dashboard" className="hover:opacity-80">
          TutelLiv
        </Link>
      </h1>
      {/* Nav (principalement utile sur mobile ; la sidebar couvre le desktop) */}
      <nav className="flex items-center gap-3 md:gap-4">
        <Link href="/dashboard" className="text-sm md:text-base hover:underline hidden sm:inline">
          Tableau de bord
        </Link>
        <Link href="/missions" className="text-sm md:text-base hover:underline hidden sm:inline">
          Missions
        </Link>
        <Link href="/invoices" className="text-sm md:text-base hover:underline hidden sm:inline">
          Factures
        </Link>
        <Link href="/beneficiaires" className="text-sm md:text-base hover:underline hidden sm:inline">
          Protégés
        </Link>
        <button
          onClick={logout}
          className="text-sm md:text-base bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700"
        >
          Déconnexion
        </button>
      </nav>
    </header>
  );
};

export default Header;
