// frontend/lib/api.ts

// --- Base via proxy Next: même origine, pas de CORS ni 127.0.0.1 ---
export const API_BASE_URL = "/api";

// Concatène proprement base + path
function joinUrl(base: string, path: string) {
  if (!path) return base;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

// --- Token helpers ---
function getToken(): string | null {
  const m =
    typeof document !== "undefined"
      ? document.cookie.match(/(?:^|;\s*)tutelliv_token=([^;]+)/)
      : null;
  if (m?.[1]) return decodeURIComponent(m[1]);
  if (typeof localStorage !== "undefined")
    return localStorage.getItem("tutelliv_token");
  return null;
}

// --- Fetch helper générique ---
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(joinUrl(API_BASE_URL, path), {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include", // OK si tu utilises des cookies côté back
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail)
        msg =
          typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* body non JSON */
    }
    throw new Error(msg);
  }

  // @ts-expect-error - back peut renvoyer vide (logout)
  return res.status === 204 ? null : res.json();
}

// --- Types ---
export type User = {
  id: number;
  email: string;
  role: "mjpm" | "deliverer";
  name: string;
};

// --- Auth ---
export const login = async (email: string, password: string) => {
  const out = await api<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (typeof document !== "undefined") {
    document.cookie = `tutelliv_token=${encodeURIComponent(
      out.token
    )}; path=/; max-age=${60 * 60 * 24}`;
    document.cookie = `tutelliv_role=${encodeURIComponent(
      out.user.role
    )}; path=/; max-age=${60 * 60 * 24}`;
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("tutelliv_token", out.token);
  }
  return out;
};

export const me = () => api<{ user: User }>("/auth/me");

export const logout = async () => {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    if (typeof document !== "undefined") {
      document.cookie = `tutelliv_token=; path=/; max-age=0`;
      document.cookie = `tutelliv_role=; path=/; max-age=0`;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("tutelliv_token");
    }
  }
};

// --- Health ---
export const health = () => api<{ status: string }>("/health");

// --- Stats ---
export const getStats = () => api<import("@/lib/types").Stats>("/stats");

// --- Beneficiaries ---
export const listBeneficiaries = () =>
  api<import("@/lib/types").Beneficiary[]>("/beneficiaries");

export const getBeneficiary = (id: string | number) =>
  api<import("@/lib/types").Beneficiary>(`/beneficiaries/${id}`);

export const createBeneficiary = (
  b: Omit<import("@/lib/types").Beneficiary, "id">
) =>
  api<import("@/lib/types").Beneficiary>("/beneficiaries", {
    method: "POST",
    body: JSON.stringify(b),
  });

// --- Missions ---
export const listMissions = () =>
  api<import("@/lib/types").Mission[]>("/missions");

export const getMission = (id: string) =>
  api<import("@/lib/types").Mission>(`/missions/${id}`);

export const createMission = (m: {
  beneficiary_id: number;
  categories: string[];
  comments_by_category?: Record<string, string>;
  general_comment?: string | null;
  status?: string;
}) =>
  api<import("@/lib/types").Mission>("/missions", {
    method: "POST",
    body: JSON.stringify(m),
  });

export const updateMission = (
  id: string,
  m: {
    beneficiary_id: number;
    categories: string[];
    comments_by_category?: Record<string, string>;
    general_comment?: string | null;
    status?: string;
  }
) =>
  api<import("@/lib/types").Mission>(`/missions/${id}`, {
    method: "PUT",
    body: JSON.stringify(m),
  });

// Helpers actions livreur
import type { Mission as TMission } from "@/lib/types";
const getCats = (m: TMission) =>
  m.categories?.length ? m.categories : m.category ? [m.category] : [];
const getGeneral = (m: TMission) => m.general_comment ?? m.comment ?? null;

export const acceptMission = (m: TMission) =>
  updateMission(m.id, {
    beneficiary_id: m.beneficiary_id,
    categories: getCats(m),
    comments_by_category: m.comments_by_category,
    general_comment: getGeneral(m),
    status: "in_progress",
  });

export const deliverMission = (m: TMission) =>
  updateMission(m.id, {
    beneficiary_id: m.beneficiary_id,
    categories: getCats(m),
    comments_by_category: m.comments_by_category,
    general_comment: getGeneral(m),
    status: "delivered",
  });

// --- Invoices ---
export const listInvoices = () =>
  api<import("@/lib/types").Invoice[]>("/invoices");

export const updateInvoice = (
  id: string,
  data: {
    amount: number;
    status: "editing" | "pending" | "paid" | "draft" | "unpaid" | string;
    note?: string | null;
    lines_by_category?: Record<string, { amount: number; note?: string }>;
    delivery_fee?: number;
  }
) =>
  api<import("@/lib/types").Invoice>(`/invoices/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      mission_id: "",
      amount: data.amount,
      status: data.status,
      note: data.note ?? null,
      lines_by_category: data.lines_by_category ?? undefined,
      delivery_fee: data.delivery_fee ?? undefined,
    }),
  });

// Trouve l'ID de facture liée à une mission
export const findInvoiceIdByMission = async (missionId: string) => {
  const invoices = await listInvoices();
  const hit = invoices.find((i) => i.mission_id === missionId);
  return hit?.id ?? null;
};

// Nouvelle: envoie le détail + passe "pending"
export const setInvoiceDetailedAndPending = async (
  invoiceId: string,
  payload: {
    lines_by_category: Record<string, { amount: number; note?: string }>;
    delivery_fee: number;
    amount: number;
    note?: string | null;
  }
) => {
  return updateInvoice(invoiceId, {
    amount: payload.amount,
    status: "pending",
    note: payload.note ?? null,
    lines_by_category: payload.lines_by_category,
    delivery_fee: payload.delivery_fee,
  });
};

// ✅ Helpers PDF (avec token dans l’URL)
export const getInvoicePdfUrl = (invoiceId: string) => {
  const token = getToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return joinUrl(API_BASE_URL, `/invoices/${invoiceId}/pdf${qs}`);
};

export const openInvoicePdf = (invoiceId: string) => {
  const url = getInvoicePdfUrl(invoiceId);
  if (typeof window !== "undefined") window.open(url, "_blank");
};
