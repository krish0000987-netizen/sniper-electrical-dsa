/**
 * SNIPER Integration Hub — adapter catalog & driver contracts.
 *
 * Every external provider SNIPER can talk to is described by an AdapterDef in
 * the catalog below. A driver implementation (mock / digitap / pending) turns
 * an integration row + an input into a normalized AdapterResult. The CRM never
 * depends on a provider's raw response shape — mappers normalize per adapter.
 *
 * SECURITY: no secret ever lives in an AdapterDef / integration row. Credentials
 * are read from the process environment only (server/.env, git-ignored).
 */

export type AdapterScope = "identity" | "credit" | "business" | "banking" | "payments" | "documents" | "communication";

/** Effective operational state of an adapter, computed from config + live probes. */
export type AdapterStatus = "connected" | "sandbox" | "error" | "not_configured" | "awaiting_enablement";

/** How the adapter is being driven right now. */
export type AdapterMode = "mock" | "live" | "pending";

export interface DigitapSuite {
  /** Digitap product family (KYC Validation, Onboarding, Alternate Data, ...) */
  family: string;
  /** Product/suite display name inside that family */
  product: string;
  /** Set once Digitap has enabled the suite for this client AND we hold its API doc */
  enabled: boolean;
  /** Human note shown in the hub (what to ask Digitap for, etc.) */
  note: string;
}

export interface AdapterDef {
  /** Stable code — matches integrations.code rows and client grouping */
  code: string;
  name: string;
  category: AdapterScope;
  /** True when the customer asked this adapter to stay out of live scope */
  excluded: boolean;
  /** Who powers it (always Digitap per product decision; null = unmapped) */
  digitap: DigitapSuite | null;
  /** Adapter driver family: "digitap" once a live driver exists, else "pending" */
  driver: "digitap" | "pending" | "local";
  /** Whether provider calls for this adapter need an explicit consent record */
  needsConsent: boolean;
}

/** Adapter availability declared by Digitap for client 07625809 (UAT, probed). */
const KYC_ENABLED = { panBasic: true, rest: false };

export const ADAPTER_CATALOG: AdapterDef[] = [
  // ---------- Identity ----------
  {
    code: "pan_verify", name: "PAN Verification", category: "identity", excluded: false,
    digitap: { family: "KYC Validation", product: "PAN Basic (V1/V2)", enabled: KYC_ENABLED.panBasic, note: "Credentials configured? Click Test — a passing live probe turns this adapter Connected." },
    driver: "digitap", needsConsent: true
  },
  {
    code: "ckyc", name: "CKYC", category: "identity", excluded: false,
    digitap: { family: "KYC Validation", product: "CKYC (fetch/update)", enabled: false, note: "Ask Digitap to enable CKYC and share its API doc." },
    driver: "pending", needsConsent: true
  },
  {
    code: "aadhaar_ovd", name: "Aadhaar / OVD", category: "identity", excluded: false,
    digitap: { family: "KYC Validation", product: "Aadhaar & OVD APIs", enabled: false, note: "Doc held (KYC suite) but client returns 401 — ask Digitap to enable Aadhaar/OVD products." },
    driver: "pending", needsConsent: true
  },
  // ---------- Credit ----------
  {
    code: "cibil", name: "TransUnion CIBIL", category: "credit", excluded: false,
    digitap: { family: "Credit Bureau", product: "CIBIL CIR", enabled: false, note: "Ask Digitap for the Credit Bureau suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  {
    code: "experian", name: "Experian", category: "credit", excluded: false,
    digitap: { family: "Credit Bureau", product: "Experian CIR", enabled: false, note: "Ask Digitap for the Credit Bureau suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  {
    code: "equifax", name: "Equifax", category: "credit", excluded: false,
    digitap: { family: "Credit Bureau", product: "Equifax CIR", enabled: false, note: "Ask Digitap for the Credit Bureau suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  {
    code: "crif", name: "CRIF High Mark", category: "credit", excluded: false,
    digitap: { family: "Credit Bureau", product: "CRIF High Mark CIR", enabled: false, note: "Ask Digitap for the Credit Bureau suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  // ---------- Business ----------
  {
    code: "gst", name: "GSTN", category: "business", excluded: false,
    digitap: { family: "Business Data", product: "GSTN profile", enabled: false, note: "Ask Digitap for the business-data suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  {
    code: "mca", name: "MCA", category: "business", excluded: false,
    digitap: { family: "Business Data", product: "MCA21 registry", enabled: false, note: "Ask Digitap for the business-data suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  {
    code: "udyam", name: "Udyam", category: "business", excluded: false,
    digitap: { family: "Business Data", product: "Udyam registration", enabled: false, note: "Ask Digitap for the business-data suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  // ---------- Banking ----------
  {
    code: "account_aggregator", name: "Account Aggregator", category: "banking", excluded: false,
    digitap: { family: "Account Aggregator (TSP/FIU)", product: "AA consent flow", enabled: false, note: "Digitap is a certified AA TSP — ask for the AA suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  {
    code: "bank_statement", name: "Bank Statement Parser", category: "banking", excluded: false,
    digitap: { family: "Alternate Data", product: "Bank Statement Analyzer", enabled: false, note: "Ask Digitap for the Alternate Data / BSA suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  // ---------- Payments (excluded from live scope per business decision) ----------
  { code: "upi", name: "UPI (PG)", category: "payments", excluded: true, digitap: { family: "Payments", product: "UPI collect/refund", enabled: false, note: "Out of scope for this integration pass." }, driver: "pending", needsConsent: false },
  { code: "nach", name: "NACH / eNACH", category: "payments", excluded: true, digitap: { family: "Payments", product: "NACH mandate", enabled: false, note: "Out of scope for this integration pass." }, driver: "pending", needsConsent: true },
  { code: "neft_imps", name: "NEFT / IMPS", category: "payments", excluded: true, digitap: { family: "Payments", product: "Bank transfer", enabled: false, note: "Out of scope for this integration pass." }, driver: "pending", needsConsent: false },
  // ---------- Documents ----------
  {
    code: "esign", name: "E-Sign Provider", category: "documents", excluded: false,
    digitap: { family: "Onboarding Suite", product: "Aadhaar / OTP eSign", enabled: false, note: "Ask Digitap for the Onboarding (eSign) suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  {
    code: "ocr", name: "OCR Engine", category: "documents", excluded: false,
    digitap: { family: "Onboarding Suite", product: "OCR & OVD validation", enabled: false, note: "Ask Digitap for the Onboarding (OCR) suite doc + enablement." },
    driver: "pending", needsConsent: true
  },
  // ---------- Communication (excluded from live scope per business decision) ----------
  { code: "whatsapp", name: "WhatsApp Business", category: "communication", excluded: true, digitap: { family: "Communication", product: "WhatsApp API", enabled: false, note: "Out of scope for this integration pass." }, driver: "pending", needsConsent: false },
  { code: "sms", name: "SMS Gateway", category: "communication", excluded: true, digitap: { family: "Communication", product: "SMS API", enabled: false, note: "Out of scope for this integration pass." }, driver: "pending", needsConsent: false },
  { code: "email", name: "Email Service", category: "communication", excluded: true, digitap: { family: "Communication", product: "Transactional email", enabled: false, note: "Out of scope for this integration pass." }, driver: "pending", needsConsent: false }
];

export const CATALOG_BY_CODE = new Map(ADAPTER_CATALOG.map((a) => [a.code, a]));

/** Normalized result handed back to CRM code — never raw provider JSON. */
export interface AdapterResult {
  ok: boolean;
  /** machine + human readable status */
  status: "verified" | "invalid" | "not_found" | "provider_error" | "consent_required" | "not_enabled" | "sandbox";
  message: string;
  /** normalized, minimal, purpose-limited data (masked where sensitive) */
  data?: Record<string, unknown>;
  /** provider-side references (request_id etc.) for audit trail */
  providerRef?: string;
  /** adapter + suite that produced this result */
  provider: string;
  /** true when produced by the labelled mock driver (never in prod config) */
  sandbox?: boolean;
  /** latency of the provider call in ms (mock = 0) */
  latencyMs?: number;
  /** provider-side error code when !ok */
  errorCode?: string;
}

export interface AdapterContext {
  tenantId: number;
  userId: number;
  clientIp?: string;
}

/** Mapper output kept purpose-limited: no full Aadhaar ever leaves the backend. */
export interface PanVerification {
  panMasked: string;
  panStatus: "Active" | "Invalid" | "Unknown";
  statusCode: string;
  nameMatch: boolean | null;
  nameMatchScore: number | null;
  dobMatch: boolean | null;
  seedingStatus: string;
  nameFromPan: string;
  panDisplayName: string;
}
