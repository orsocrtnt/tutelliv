import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Chemins accessibles sans être connecté
const PUBLIC_PATHS = ["/login", "/_next", "/favicon.ico", "/public", "/api"];

// Vérifie si la route appartient à l’espace "livreur"
const isCourierPath = (p: string) => p.startsWith("/courier");

// Vérifie si la route appartient à l’espace "MJPM"
const isMjpmPath = (p: string) =>
  [
    "/dashboard",
    "/missions",
    "/beneficiaires", // inclut /beneficiaires et toutes ses sous-routes
    "/invoices",
    "/settings",
  ].some((prefix) => p === prefix || p.startsWith(prefix + "/"));

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Laisser passer les chemins publics
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("tutelliv_token")?.value;
  const role = req.cookies.get("tutelliv_role")?.value as
    | "mjpm"
    | "deliverer"
    | undefined;

  // Pas connecté → redirige vers /login
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Contrôle d'accès par rôle
  if (isCourierPath(pathname) && role !== "deliverer") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (isMjpmPath(pathname) && role === "deliverer") {
    const url = req.nextUrl.clone();
    url.pathname = "/courier/dashboard";
    return NextResponse.redirect(url);
  }

  // Sinon, accès autorisé
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|public).*)"],
};
