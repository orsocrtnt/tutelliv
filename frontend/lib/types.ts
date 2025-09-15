// frontend/lib/types.ts

export interface Beneficiary {
  id: number | string;
  first_name: string;
  last_name: string;
  address: string;
  city?: string;
  postal_code?: string;
  country?: string | null;
  measure_type?: string | null;
  archived?: boolean;
  phone?: string | null;
  photo_url?: string | null;
  is_active?: boolean;
}

export interface Mission {
  id: string;
  beneficiary_id: number;

  // nouveau modèle
  categories: string[];
  comments_by_category?: Record<string, string>;
  general_comment?: string | null;

  // compat
  category?: string;
  comment?: string | null;

  status: "pending" | "in_progress" | "delivered" | string;
  created_at?: string; // ISO

  // ✅ créneau calendrier
  calendar_start?: string; // ISO
  calendar_end?: string;   // ISO
}

export interface Invoice {
  id: string;
  mission_id: string;
  amount: number;
  status: "editing" | "pending" | "paid" | "draft" | "unpaid" | string;
  created_at?: string;
  note?: string | null;
  lines_by_category?: Record<string, { amount: number; note?: string | null }>;
  delivery_fee?: number;
}

export interface Stats {
  missions_in_progress: number;
  beneficiaries_active: number;
  invoices_pending: number;
  generated_at: string;
}
