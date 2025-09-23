import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Chemins accessibles sans être connecté (ajout /courier/login, /images, /assets)
const PUBLIC_PATHS = [
  "/login",
  "/courier/login",
  "/_next",
  "/favicon.ico",
  "/public",
  "/images",
  "/assets",
  "/api", // routes API Next (si tu en as)
];

// Espace "livreur"
const isCourierPath = (p: string) => p.startsWith("/courier");

// Espace "MJPM"
const isMjpmPath = (p: string) =>
  [
    "/",
    "/dashboard",
    "/missions",
    "/beneficiaires",
    "/invoices",
    "/settings",
  ].some((prefix) => p === prefix || p.startsWith(prefix + "/"));

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Laisser passer les chemins publics (assets, api, login…)
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("tutelliv_token")?.value;
  const role = req.cookies.get("tutelliv_role")?.value as
    | "mjpm"
    | "deliverer"
    | undefined;

  // Pas connecté → /login (avec ?next=…)
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

  // Accès autorisé
  return NextResponse.next();
}

export const config = {
  // Ignore tout ce qui est statique + API Next
  matcher: ["/((?!_next|favicon.ico|public|images|assets|api).*)"],
};
