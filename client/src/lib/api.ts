const TOKEN_KEY = "sniper_token";

// Base URL for the API. Defaults to the same origin (relative /api, proxied by
// the Vite dev server). Set VITE_API_BASE to point the built app at a
// separately hosted API, e.g. VITE_API_BASE=https://loanserver.vercel.app.
const API_BASE: string = (import.meta as any).env?.VITE_API_BASE ?? "";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API_BASE + "/api" + path, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, json.error || res.statusText);
  }
  return json as T;
}

export function fmtInr(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 10000000) return "₹" + (n / 10000000).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " Cr";
  if (Math.abs(n) >= 100000) return "₹" + (n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " L";
  return "₹" + n.toLocaleString("en-IN");
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d.length === 10 ? d + "T00:00:00" : d);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + ", " + date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const STAGE_LABELS: Record<string, string> = {
  application: "Application", kyc: "KYC", documents: "Documents", credit: "Credit Bureau",
  banking: "Bank Analysis", gst: "GST", bre: "BRE", underwriting: "Underwriting",
  approval: "Approval", sanction: "Sanction", kfs: "Key Fact Statement",
  agreement: "Agreement", esign: "E-Sign", disbursement: "Disbursement"
};

export const STATUS_STYLE: Record<string, string> = {
  new: "badge-blue", assigned: "badge-indigo", contacted: "badge-indigo", interested: "badge-green",
  followup: "badge-amber", converted: "badge-green", dnd: "badge-zinc", wrong_number: "badge-gray",
  lost: "badge-red", not_interested: "badge-gray",
  active: "badge-green", overdue: "badge-red", closed: "badge-zinc", written_off: "badge-gray",
  restructured: "badge-amber", disbursed: "badge-blue", approved: "badge-green", rejected: "badge-red",
  in_progress: "badge-indigo", draft: "badge-gray", pending: "badge-amber",
  eligible: "badge-green", verified: "badge-green", paid: "badge-green",
  part_paid: "badge-amber", open: "badge-blue", done: "badge-green", resolved: "badge-green",
  escalated: "badge-red", promised: "badge-indigo", kept: "badge-green", broken: "badge-red",
  requested: "badge-amber", issued: "badge-blue", signed: "badge-green", generated: "badge-indigo",
  compliant: "badge-green", blocked: "badge-red", completed: "badge-green", skipped: "badge-gray",
  uploaded: "badge-blue", failed: "badge-red", sandbox: "badge-amber", connected: "badge-green",
  not_configured: "badge-gray", error: "badge-red", medium: "badge-amber", high: "badge-red",
  critical: "badge-red", low: "badge-green", standard: "badge-blue", superseded: "badge-gray",
  retired: "badge-gray", cancelled: "badge-gray", expired: "badge-gray", withdrawn: "badge-gray",
  closed_loan: "badge-zinc", approved_wc: "badge-green", send_back: "badge-amber",
  inactive: "badge-gray", scheduled: "badge-blue", zinc: "badge-zinc", indigo: "badge-indigo"
};

export function badgeFor(status: string | null | undefined): string {
  return STATUS_STYLE[status || ""] || "badge-gray";
}

export function statusLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
