import { q, q1, run } from "./connection.js";
import { computeCommission, gnSettings, seedRolePermissions } from "../core/gn.js";
import {
  applicantRef, grantConsent, normMobile, runKyc, runCredit, matchApplicant, storeMatches, createApplication,
  submitApplication, simulateLender, processBulkBatch
} from "../core/gn-co.js";
import { generateDemoRows, validateRow } from "../routes/gn-bulk.js";

/* Deterministic RNG shared with the main seed */
export type GnRng = () => number;

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function pick<T>(rng: GnRng, arr: T[]): T { return arr[Math.floor(rng() * arr.length)]; }
function range(min: number, max: number, rng: GnRng): number { return Math.round(min + rng() * (max - min)); }

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

type GnCustomer = Record<string, any>;

export async function seedGrowthNations(tenantId: number, rng: GnRng, customers: GnCustomer[], userIds: number[]) {
  const today = new Date();
  const managerIds = userIds.slice(0, 12);
  const salesIds = userIds.slice(0, 5);

  /* ---------- settings ---------- */
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_settings', ?)",
    [tenantId, JSON.stringify({ tds_pct: 2, gst_pct: 18, partner_split_pct: 60 })]);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_company', ?)",
    [tenantId, JSON.stringify({
      name: "Growth Nations Distribution Pvt Ltd", legal_name: "Growth Nations Distribution Private Limited",
      gstin: "27ABCDE1234F1Z5", pan: "ABCDE1234F", cin: "U65990MH2020PTC345678",
      address: "901, Trade Tower, Andheri East, Mumbai 400069", city: "Mumbai", state: "Maharashtra", pincode: "400069",
      email: "accounts@growthnations.in", phone: "+91 98200 12345", website: "www.growthnations.in",
      invoice_prefix: "GN-INV", tds_section: "194H", tds_pct: 2, gst_pct: 18, logo_url: ""
    })]);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_api_keys', ?)",
    [tenantId, JSON.stringify([
      { id: 1, label: "Production — Lending Partner A", key: "gn_live_7f3a9c1e2b4d5f6a8c0e1d2f3a4b5c6d", created_at: "2026-02-10T10:00:00Z", status: "active", last_used: "2026-08-10T09:30:00Z" },
      { id: 2, label: "Sandbox — Verification APIs", key: "gn_test_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", created_at: "2026-05-01T10:00:00Z", status: "active", last_used: "2026-08-11T18:00:00Z" }
    ])]);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_leave_types', ?)",
    [tenantId, JSON.stringify([
      { name: "Casual Leave", code: "CL", paid: true, days: 12, carry_forward: 5, applicable_to: "staff" },
      { name: "Sick Leave", code: "SL", paid: true, days: 10, carry_forward: 0, applicable_to: "staff" },
      { name: "Earned Leave", code: "EL", paid: true, days: 15, carry_forward: 15, applicable_to: "staff" },
      { name: "Privilege Leave", code: "PL", paid: true, days: 20, carry_forward: 10, applicable_to: "manager" },
      { name: "Compensatory Off", code: "CO", paid: true, days: 5, carry_forward: 2, applicable_to: "field" },
      { name: "Maternity Leave", code: "ML", paid: true, days: 182, carry_forward: 0, applicable_to: "staff" },
      { name: "Paternity Leave", code: "PTL", paid: true, days: 15, carry_forward: 0, applicable_to: "staff" },
      { name: "Unpaid Leave", code: "UL", paid: false, days: 30, carry_forward: 0, applicable_to: "all" }
    ])]);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_holidays', ?)",
    [tenantId, JSON.stringify([
      { date: "2026-01-26", name: "Republic Day" }, { date: "2026-03-20", name: "Holi" },
      { date: "2026-04-14", name: "Ambedkar Jayanti" }, { date: "2026-05-24", name: "Buddha Purnima" },
      { date: "2026-08-15", name: "Independence Day" }, { date: "2026-09-17", name: "Ganesh Chaturthi" },
      { date: "2026-10-02", name: "Gandhi Jayanti" }, { date: "2026-11-19", name: "Diwali" },
      { date: "2026-11-26", name: "Guru Nanak Jayanti" }, { date: "2026-12-25", name: "Christmas" }
    ])]);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_office_timings', ?)",
    [tenantId, JSON.stringify({ start: "09:30", end: "18:30", lunch_start: "13:30", lunch_end: "14:00", workdays: [1, 2, 3, 4, 5, 6], grace_minutes: 15, weekly_off: "Sunday" })]);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_reseller', ?)",
    [tenantId, JSON.stringify({ enabled: false, brand_name: "NEXUS", support_email: "support@nexus.demo", domain: "", primary_color: "#2563eb", portal_name: "NEXUS Partner Portal" })]);
  await run("INSERT OR REPLACE INTO system_config (tenant_id, key, value) VALUES (?, 'gn_bank', ?)",
    [tenantId, JSON.stringify({ account_name: "Growth Nations Distribution Pvt Ltd", bank: "HDFC Bank", account_no: "50100234567890", ifsc: "HDFC0001234", upi: "growthnations@hdfcbank", settlement_cycle_days: 7 })]);

  /* ---------- lenders ---------- */
  const lenderDefs: [string, string, string, string, string, string, string][] = [
    ["SBI", "Bank", "SBIDSA0421", "Rajesh Iyer", "+919810000001", "rajesh.iyer@sbi.in", "client"],
    ["ICICI Bank", "Bank", "ICDSA2011", "Meera Nair", "+919810000002", "meera.nair@icicibank.com", "client"],
    ["HDFC Bank", "Bank", "HDFCDSA118", "Amit Kulkarni", "+919810000003", "amit.kulkarni@hdfcbank.com", "client"],
    ["Axis Bank", "Bank", "AXSDSA776", "Sneha Pillai", "+919810000004", "sneha.pillai@axisbank.com", "client"],
    ["Bajaj Finserv", "NBFC", "BFSDSA903", "Kunal Desai", "+919810000005", "kunal.desai@bajajfinserv.in", "split"],
    ["TVS Credit", "NBFC", "TVSDSA331", "Divya Menon", "+919810000006", "divya.menon@tvscredit.com", "split"],
    ["Indostar Capital", "NBFC", "INDSA112", "Vikram Sethi", "+919810000007", "vikram.sethi@indostar.com", "client"],
    ["Hero FinCorp", "HFC", "HFCDSA447", "Ritu Bansal", "+919810000008", "ritu.bansal@herofincorp.com", "client"]
  ];
  const lenderIds: number[] = [];
  for (const [name, type, code, cp, phone, email, gst] of lenderDefs) {
    lenderIds.push((await run(
      "INSERT INTO gn_lenders (tenant_id, name, type, dsa_code, contact_person, contact_phone, contact_email, gst_policy, api_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mock', 'active')",
      [tenantId, name, type, code, cp, phone, email, gst])).lastId);
  }

  /* ---------- products ---------- */
  const productDefs: [number, string, string, number, number, number, number, number, number, number, number, number, number][] = [
    // lenderIdx, category, name, min, max, minT, maxT, roiMin, roiMax, feePct, payoutPct, minTurnover, minVintage
    [0, "Business Loan", "SBI Business Loan", 200000, 5000000, 12, 60, 14, 16.5, 1.5, 1.2, 1000000, 2],
    [1, "Business Loan", "ICICI Business Loan", 100000, 7500000, 12, 72, 15, 17.5, 2.0, 1.0, 800000, 1],
    [4, "Business Loan", "Bajaj Business Loan", 100000, 4000000, 12, 60, 16, 19, 2.5, 1.5, 600000, 1],
    [2, "Home Loan", "HDFC Home Loan", 300000, 10000000, 12, 240, 9.5, 11.5, 1.0, 0.6, 0, 0],
    [0, "Home Loan", "SBI Home Loan", 300000, 15000000, 12, 240, 9.4, 11.0, 0.9, 0.5, 0, 0],
    [3, "Loan Against Property", "Axis LAP", 1000000, 20000000, 12, 180, 10.5, 13.0, 1.5, 0.9, 2000000, 3],
    [1, "Loan Against Property", "ICICI LAP", 500000, 15000000, 12, 180, 10.8, 13.5, 1.5, 0.85, 1500000, 2],
    [2, "Personal Loan", "HDFC Personal Loan", 50000, 2500000, 12, 60, 12.5, 16.0, 2.0, 1.0, 0, 0],
    [4, "Personal Loan", "Bajaj Personal Loan", 50000, 3500000, 12, 60, 13.0, 17.0, 2.5, 1.2, 0, 0],
    [5, "Commercial Vehicle", "TVS CV Loan", 200000, 2000000, 12, 84, 11.5, 14.0, 1.5, 1.8, 800000, 1],
    [4, "Commercial Vehicle", "Bajaj CV Loan", 300000, 3000000, 12, 84, 12.0, 15.0, 1.5, 1.6, 1000000, 1],
    [5, "Two Wheeler", "TVS Two Wheeler Loan", 20000, 300000, 6, 36, 13.0, 17.0, 2.0, 2.5, 0, 0],
    [6, "MSME", "Indostar MSME Loan", 500000, 5000000, 12, 84, 13.0, 16.0, 2.0, 1.4, 1500000, 3],
    [7, "Two Wheeler", "Hero Two Wheeler Loan", 20000, 250000, 6, 36, 12.0, 16.0, 2.0, 2.8, 0, 0],
    [7, "Equipment Financing", "Hero Equipment Loan", 200000, 3000000, 12, 60, 12.5, 15.5, 1.5, 2.0, 1000000, 2],
    [6, "Working Capital", "Indostar Working Capital", 300000, 3000000, 6, 24, 15.0, 18.0, 1.5, 1.1, 800000, 2],
    [3, "Education Loan", "Axis Education Loan", 100000, 5000000, 12, 120, 11.0, 13.5, 1.0, 0.8, 0, 0],
    [2, "Gold Loan", "HDFC Gold Loan", 10000, 2000000, 3, 24, 11.0, 14.0, 0.5, 1.5, 0, 0],
    [0, "Agriculture", "SBI Agriculture Loan", 50000, 2000000, 6, 36, 10.0, 12.0, 1.0, 1.3, 0, 0],
    [4, "Balance Transfer", "Bajaj Balance Transfer", 100000, 3000000, 12, 48, 13.0, 15.5, 1.0, 0.9, 0, 0]
  ];
  const productIds: number[] = [];
  const productMeta: { id: number; lenderId: number; name: string; category: string; payout: number; min: number; max: number }[] = [];
  const docSets: Record<string, string[]> = {
    "Business Loan": ["pan", "gst", "bank_statement", "itr", "business_reg"],
    "Home Loan": ["pan", "aadhaar", "bank_statement", "salary_slip", "property"],
    "Loan Against Property": ["pan", "aadhaar", "bank_statement", "itr", "property"],
    "Personal Loan": ["pan", "aadhaar", "bank_statement", "salary_slip"],
    "Commercial Vehicle": ["pan", "aadhaar", "bank_statement", "business_reg"],
    "Two Wheeler": ["pan", "aadhaar", "address_proof"],
    MSME: ["pan", "gst", "bank_statement", "itr", "business_reg"],
    "Equipment Financing": ["pan", "gst", "bank_statement", "itr", "business_reg"],
    "Working Capital": ["pan", "gst", "bank_statement", "itr"],
    "Education Loan": ["pan", "aadhaar", "address_proof", "admission_letter"],
    "Gold Loan": ["pan", "aadhaar"],
    Agriculture: ["pan", "aadhaar", "land_record"],
    "Balance Transfer": ["pan", "aadhaar", "bank_statement", "existing_loan_statement"]
  };
  for (const [lendIdx, cat, name, min, max, minT, maxT, roiMin, roiMax, fee, payout, turn, vin] of productDefs) {
    const id = (await run(
      `INSERT INTO gn_products (tenant_id, lender_id, category, name, vertical, min_amount, max_amount, min_tenure, max_tenure,
         roi_min, roi_max, processing_fee_pct, payout_pct, min_turnover, min_vintage, min_income, geography, required_documents, status)
       VALUES (?, ?, ?, ?, 'fi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 20000, '[]', ?, 'active')`,
      [tenantId, lenderIds[lendIdx], cat, name, min, max, minT, maxT, roiMin, roiMax, fee, payout, turn === 0 ? null : turn, vin === 0 ? null : vin,
       JSON.stringify(docSets[cat] ?? ["pan"])])).lastId;
    productIds.push(id);
    productMeta.push({ id, lenderId: lenderIds[lendIdx], name, category: cat, payout, min, max });
  }

  /* ---------- schemes ---------- */
  const schemeIds: number[] = [];
  const mkScheme = async (lenderId: number, productId: number | null, name: string, opts: Record<string, any> = {}) => {
    const params: any[] = [tenantId, lenderId, productId, name, opts.payout_type ?? "percent", opts.rate ?? 0, opts.flat_amount ?? 0,
      JSON.stringify(opts.slabs ?? []), opts.effective_from ?? iso(addMonths(today, -6)), opts.effective_to ?? null, opts.status ?? "active",
      opts.profile ?? null, JSON.stringify(opts.states ?? ["All India"]), JSON.stringify(opts.loan_params ?? {}), JSON.stringify(opts.eligibility ?? {}),
      JSON.stringify(opts.programs ?? []), JSON.stringify(opts.purposes ?? []), opts.usp ?? null, opts.commission_pct ?? opts.rate ?? 0,
      JSON.stringify(opts.policy ?? {}), opts.source ?? "manual", opts.notes ?? null,
      opts.banker_name ?? null, opts.banker_email ?? null, opts.banker_phone ?? null, opts.branch ?? null, opts.sub_product ?? null];
    schemeIds.push((await run(
      `INSERT INTO gn_schemes (tenant_id, lender_id, product_id, name, payout_type, rate, flat_amount, slabs, effective_from, effective_to, status,
         profile, states, loan_params, eligibility, programs, purposes, usp, commission_pct, policy, source, notes,
         banker_name, banker_email, banker_phone, branch, sub_product)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params)).lastId);
  };
  const profiles: Record<string, string> = {
    "Business Loan": "Self-Employed / Business", "Home Loan": "Salaried / Self-Employed", "Loan Against Property": "Business / Salaried",
    "Personal Loan": "Salaried", "Commercial Vehicle": "Self-Employed / Fleet", "Two Wheeler": "Salaried / Self-Employed",
    MSME: "Business", "Equipment Financing": "Business", "Working Capital": "Business", "Education Loan": "Salaried (parent/student)",
    "Gold Loan": "All", Agriculture: "Farmer / Agri", "Balance Transfer": "Salaried"
  };
  for (const p of productMeta) {
    await mkScheme(p.lenderId, p.id, `${p.name} — Standard Payout`, {
      rate: p.payout, profile: profiles[p.category] ?? "All", commission_pct: p.payout,
      loan_params: { min_amount: p.min, max_amount: p.max, min_tenure: 12, max_tenure: p.category === "Home Loan" ? 240 : 60 },
      eligibility: { min_income: p.category === "Salaried" ? 20000 : 0, min_turnover: 0, min_vintage: 1, max_foir: 50, max_ltv: p.category === "Home Loan" ? 90 : 75, min_credit_score: 650 },
      programs: ["Standard"], purposes: [p.category],
      policy: { negative_list: [], cibil_required: true, notes: "Standard scheme for all DSA channels" },
      source: "feed"
    });
  }
  // Slab-based scheme + flat scheme
  await mkScheme(lenderIds[5], null, "TVS Credit — DSA Monthly Volume Slab", {
    payout_type: "slab", rate: 0, flat_amount: 0,
    slabs: [
      { min: 0, max: 5000000, rate: 1.2 }, { min: 5000000, max: 15000000, rate: 1.5 }, { min: 15000000, max: 40000000, rate: 1.8 },
      { min: 40000000, max: 100000000, rate: 2.1 }, { min: 100000000, max: null, rate: 2.5 }
    ],
    effective_from: iso(addMonths(today, -8)), profile: "All", states: ["Maharashtra", "Gujarat", "Karnataka", "Tamil Nadu"],
    programs: ["Standard"], purposes: ["Commercial Vehicle"], usp: "Higher slab rates above ₹5L monthly volume — top DSAs earn 2.5%",
    commission_pct: 1.8, policy: { cibil_required: true, notes: "Slab is evaluated on monthly disbursed volume" }, source: "feed"
  });
  await mkScheme(lenderIds[7], null, "Hero FinCorp — Flat Incentive", {
    payout_type: "flat", rate: 0, flat_amount: 2500, effective_from: iso(addMonths(today, -4)), profile: "All",
    programs: ["Standard"], purposes: ["Two Wheeler", "Equipment Financing"], usp: "₹2,500 flat per loan booked",
    commission_pct: 0, policy: { cibil_required: true, notes: "Flat incentive per disbursed loan" }, source: "feed"
  });
  /* Flagship schemes with full policy blocks */
  await mkScheme(lenderIds[2], null, "HDFC Home Loan — Salaried Special", {
    rate: 0.6, profile: "Salaried", states: ["Maharashtra", "Karnataka", "Tamil Nadu", "Delhi", "Gujarat", "Telangana"],
    loan_params: { min_amount: 500000, max_amount: 10000000, min_tenure: 12, max_tenure: 240, roi_min: 9.5, roi_max: 11.5, processing_fee_pct: 1.0, processing_fee_max: 15000, insurance_pct: 0.5, other_fees: "Legal + valuation as actual" },
    eligibility: { min_age: 21, max_age: 60, min_income: 35000, min_turnover: 0, min_vintage: 0, max_foir: 50, max_ltv: 90, min_credit_score: 700, geo_radius_km: 0, property_types: ["Residential", "Under Construction", "Resale"], max_exposure: 50000000 },
    programs: ["Home Purchase", "Balance Transfer", "Top-up"], purposes: ["Home Purchase", "Home Construction", "Balance Transfer", "Top-up"],
    usp: "Special 9.5% for salaried with CIBIL ≥ 750 · LTV up to 90% for first-time buyers",
    commission_pct: 0.6, policy: { negative_list: ["Self-employed < 3yr vintage", "CIBIL < 700"], cibil_required: true, notes: "RBI circular: LTV cap 90% for ≤ ₹30L, 80% for ₹30L–₹75L" }, source: "feed"
  });
  await mkScheme(lenderIds[4], null, "Bajaj Business Loan — GST 2yr Business", {
    rate: 1.5, profile: "Self-Employed / Business", states: ["All India"],
    loan_params: { min_amount: 100000, max_amount: 4000000, min_tenure: 12, max_tenure: 60, roi_min: 16, roi_max: 19, processing_fee_pct: 2.5, processing_fee_max: 25000, insurance_pct: 1.0 },
    eligibility: { min_age: 23, max_age: 65, min_income: 0, min_turnover: 600000, min_vintage: 2, max_foir: 55, max_ltv: 0, min_credit_score: 680, property_types: [], max_exposure: 5000000 },
    programs: ["Business Expansion", "Working Capital", "Balance Transfer"], purposes: ["Business Expansion", "Working Capital", "Debt Consolidation"],
    usp: "Fast disbursal in 72 hrs for GST-registered businesses with 2+ years vintage",
    commission_pct: 1.5, policy: { negative_list: ["GST non-filer 6+ months", "CIBIL < 680"], cibil_required: true, notes: "GST returns for last 6 months mandatory" }, source: "feed"
  });
  await mkScheme(lenderIds[1], null, "ICICI LAP — LRD Program", {
    rate: 0.85, profile: "Business / Salaried", states: ["Maharashtra", "Karnataka", "Gujarat", "Delhi NCR", "Tamil Nadu"],
    loan_params: { min_amount: 1000000, max_amount: 15000000, min_tenure: 12, max_tenure: 180, roi_min: 10.8, roi_max: 13.5, processing_fee_pct: 1.5, processing_fee_max: 30000, insurance_pct: 0.5 },
    eligibility: { min_age: 25, max_age: 65, min_income: 0, min_turnover: 1500000, min_vintage: 2, max_foir: 55, max_ltv: 60, min_credit_score: 700, property_types: ["Residential", "Commercial", "Mixed Use"], max_exposure: 20000000 },
    programs: ["LRD", "Balance Transfer", "Top-up"], purposes: ["Business Expansion", "Debt Consolidation", "Purchase"],
    usp: "Loan Against Property with LTV up to 60% — LRD program for expansion",
    commission_pct: 0.85, policy: { negative_list: ["Agricultural land", "CIBIL < 700"], cibil_required: true, notes: "Property valuation by panel valuer mandatory" }, source: "feed"
  });
  await mkScheme(lenderIds[5], null, "TVS Credit — CV Fleet Owner", {
    rate: 1.8, profile: "Self-Employed / Fleet", states: ["Tamil Nadu", "Karnataka", "Maharashtra", "Andhra Pradesh", "Telangana"],
    loan_params: { min_amount: 200000, max_amount: 2000000, min_tenure: 12, max_tenure: 84, roi_min: 11.5, roi_max: 14.0, processing_fee_pct: 1.5, processing_fee_max: 15000, insurance_pct: 1.5 },
    eligibility: { min_age: 21, max_age: 60, min_income: 0, min_turnover: 800000, min_vintage: 1, max_foir: 55, max_ltv: 85, min_credit_score: 640, property_types: [], max_exposure: 5000000 },
    programs: ["Fleet Expansion", "Replace Old Vehicle"], purposes: ["Commercial Vehicle Purchase"],
    usp: "Fleet owners with 2+ vehicles get priority underwriting",
    commission_pct: 1.8, policy: { negative_list: ["CIBIL < 640", "Fleet size > 10 without fleet card"], cibil_required: true, notes: "RC + permit + insurance docs required" }, source: "feed"
  });
  await mkScheme(lenderIds[0], null, "SBI KCC — Agri Gold", {
    rate: 1.3, profile: "Farmer / Agri", states: ["Maharashtra", "Punjab", "Haryana", "Uttar Pradesh", "Madhya Pradesh", "Andhra Pradesh"],
    loan_params: { min_amount: 50000, max_amount: 2000000, min_tenure: 6, max_tenure: 36, roi_min: 10.0, roi_max: 12.0, processing_fee_pct: 1.0, processing_fee_max: 5000, insurance_pct: 0.3 },
    eligibility: { min_age: 18, max_age: 70, min_income: 0, min_turnover: 0, min_vintage: 1, max_foir: 60, max_ltv: 75, min_credit_score: 600, property_types: ["Agricultural Land"], max_exposure: 5000000 },
    programs: ["KCC", "Crop Loan"], purposes: ["Crop Cultivation", "Farm Equipment", "Allied Activities"],
    usp: "Kisan Credit Card with interest subvention where applicable",
    commission_pct: 1.3, policy: { negative_list: ["Land without clear title"], cibil_required: false, notes: "7/12 land records + soil card where applicable" }, source: "feed"
  });
  await mkScheme(lenderIds[3], null, "Axis Education — Study Abroad", {
    rate: 0.8, profile: "Salaried (parent/student)", states: ["All India"],
    loan_params: { min_amount: 100000, max_amount: 5000000, min_tenure: 12, max_tenure: 120, roi_min: 11.0, roi_max: 13.5, processing_fee_pct: 1.0, processing_fee_max: 10000, insurance_pct: 0.5 },
    eligibility: { min_age: 18, max_age: 55, min_income: 50000, min_turnover: 0, min_vintage: 0, max_foir: 50, max_ltv: 0, min_credit_score: 680, property_types: [], max_exposure: 10000000 },
    programs: ["Study Abroad", "Domestic Education"], purposes: ["Tuition Fees", "Living Expenses", "Travel", "Equipment"],
    usp: "Collateral-free up to ₹7.5L · Co-borrower can be parent with CIBIL ≥ 680",
    commission_pct: 0.8, policy: { negative_list: ["Admission to unaccredited institution"], cibil_required: true, notes: "Admission letter + fee structure required" }, source: "feed"
  });
  /* Full reference-format scheme — every field from the banker "Add your scheme here" form (identity, parameters, eligibility, LTV, programs, commission, policy) */
  await mkScheme(lenderIds[2], null, "HDFC Home Loan — Salaried Q4 2026", {
    rate: 0.6, profile: "Salaried", states: ["Maharashtra", "Karnataka", "Tamil Nadu", "Delhi", "Gujarat", "Telangana"],
    banker_name: "Kavya Nair", banker_email: "kavya.nair@hdfcbank.com", banker_phone: "+91 97654 32109", branch: "Bengaluru Koramangala", sub_product: "Salaried HL",
    loan_params: {
      min_amount: 2500000, max_amount: 40000000, min_tenure: 60, max_tenure: 300, roi_min: 11.0, roi_max: 13.0,
      property_area_min: 600, property_area_max: 5000, bank_tat: 5, rate_notes: "Slab based on CIBIL + LTV",
      rate_salaried: 11.0, rate_senp: 11.5, processing_fee_pct: 0.5, processing_fee_max: 15000,
      processing_fee_flat: 10000, processing_fee_notes: "+ GST, capped at ₹15,000", insurance_pct: 0.5, other_fees: "Legal + valuation as actual"
    },
    eligibility: {
      min_age: 23, max_age: 65, min_income: 50000, min_turnover: 10000000, min_vintage: 3, max_foir: 75, max_ltv: 75,
      min_credit_score: 700, geo_radius_km: 40, max_enquiries_6m: 4, bt_allowed: true, bt_notes: "Min 12 EMIs paid in current loan",
      city_tiers: ["1", "2"], applicant_types: ["Salaried", "Self-Employed Professional", "Trust / Society / NGO", "Pvt Ltd / LLP / Public Ltd", "NRI"],
      employment_models: ["Salaried", "Self Employed", "Professional", "Trust", "Pvt Ltd", "Public Ltd", "LLP", "NRI"],
      property_types: ["Residential", "Commercial", "Plot", "Warehouse", "Showroom", "Mix Property", "City Area Property"],
      ltv_residential: 75, ltv_commercial: 60, ltv_industrial: 50, max_exposure: 50000000
    },
    programs: ["BT", "LRD", "Top-up", "Surrogate"], purposes: ["Home Purchase", "Top-up", "Refinance", "Construction"],
    usp: "Special 11.0% for salaried with CIBIL ≥ 750 · 5-day TAT · LTV up to 75% residential",
    commission_pct: 0.6,
    policy: {
      negative_list: ["Gambling", "Cryptocurrency", "MLM"], cibil_required: true,
      checks: ["Single Sale Deed", "CIBIL Call", "Legal Call"], city_specific: true,
      variants: ["Term Loan", "DOD"], profile_categories: ["Bank Salary", "Pvt Limited", "LLP", "Trust", "NRI"],
      notes: "Single sale deed + CIBIL call + legal call mandatory · Tier 1/2 cities only within 40 km of branch",
      circular_url: null
    }, source: "feed"
  });

  /* ---------- parent DSAs + DSA codes + bankers ---------- */
  const parentIds: number[] = [];
  for (const [name, code, contact] of [["Andromeda", "ANDROMEDA-IND", "Rohit Sharma"], ["Star Power", "STARPOWER-IN", "Priya Verma"], ["Ruloans", "RULOANS-IN", "Amit Bansal"], ["Urban Money", "URBANMONEY-IN", "Karan Shah"]] as [string, string, string][]) {
    parentIds.push((await run("INSERT INTO gn_parent_dsas (tenant_id, name, code, bank_codes, contact, status) VALUES (?, ?, ?, '[]', ?, 'active')", [tenantId, name, code, contact])).lastId);
  }
  const dsaCodeDefs: [number, string, string, number | null, number][] = [
    [0, "SBIDSA0421", "SBI Direct", null, 0], [1, "ICDSA2011", "ICICI Direct", null, 0],
    [2, "HDFCDSA118", "HDFC Direct", null, 0], [3, "AXSDSA776", "Axis Direct", null, 0],
    [4, "BFSDSA903", "Bajaj Direct", null, 0], [5, "TVSDSA331", "TVS Direct", null, 0],
    [0, "SBIPARENT-VIA", "SBI via Andromeda", parentIds[0], 1], [1, "ICICIPARENT-VIA", "ICICI via Star Power", parentIds[1], 1]
  ];
  for (const [lendIdx, code, label, parentId, via] of dsaCodeDefs) {
    await run("INSERT INTO gn_dsa_codes (tenant_id, lender_id, parent_dsa_id, code, label, via_parent, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
      [tenantId, lenderIds[lendIdx], parentId, code, label, via]);
  }
  const bankerDefs: [string, string, string, string, string, string][] = [
    ["Aalap Shah", "ICICI Bank", "Ahmedabad", "ASM", "+916359639630", ""],
    ["Ajay Shinde", "Hero FinCorp", "Pune", "RM", "+917709790928", "ajayshinde@gmail.com"],
    ["Ajeesh P", "Yes Bank", "Kollam", "ASM", "7559027105", "ajeesh.p@yes.bank.in"],
    ["Akhilesh Mandali", "SBI", "Darbhanga", "BM", "+919334429099", ""],
    ["Alok Rao", "Axis Finance", "Ahmedabad", "AVP", "+918128001774", "ALOK.RAO@AXISFINANCE.IN"],
    ["Aman Kumar", "India Shelter", "Gurugram", "Sales Manager", "+918708113846", "aman.kumar3@indiashelter.in"],
    ["Sunita Rao", "Bajaj Finserv", "Mumbai", "RM", "+919821234567", "sunita.rao@bajajfinserv.in"],
    ["Harpreet Singh", "TVS Credit", "Chandigarh", "RM", "+919876543210", "harpreet.s@tvscredit.com"],
    ["Kavya Nair", "HDFC Bank", "Bengaluru", "RM", "+919765432109", "kavya.nair@hdfcbank.com"],
    ["Prakash Jha", "Indostar Capital", "Patna", "ASM", "+919654321098", "prakash.j@indostar.com"]
  ];
  for (const [name, bank, branch, role, phone, email] of bankerDefs) {
    await run("INSERT INTO gn_bankers (tenant_id, name, bank, branch, city, role, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [tenantId, name, bank, branch, branch, role, phone, email || null]);
  }

  /* ---------- partner hierarchy ---------- */
  const partnerIds: number[] = [];
  const vivek = await q1<{ id: number }>("SELECT id FROM users WHERE email = 'info@sniperelectric.in'") ?? await q1<{ id: number }>("SELECT id FROM users WHERE role = 'tenant_admin'");
  const mkPartner = async (name: string, type: string, phone: string, email: string, comm: number, parent: number | null, userId: number | null) => {
    const id = (await run(
      "INSERT INTO gn_partners (tenant_id, name, type, phone, email, commission_pct, parent_id, user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')",
      [tenantId, name, type, phone, email, comm, parent, userId])).lastId;
    partnerIds.push(id);
    return id;
  };
  const ashishEmp = await mkPartner("Ashish Mahajan", "Sales Agent", "9850198506", "xyz@gmail.com", 15, null, null);
  const ashishGupta = await mkPartner("Ashish Gupta", "Main DSA", "9075007700", "aashishg1919@gmail.com", 45, ashishEmp, null);
  await mkPartner("Vivek Mahajan", "Master DSA", "919764044044", "info@sniperelectric.in", 60, null, vivek?.id ?? null);
  const rohit = await mkPartner("Rohit Malhotra", "DSA", "9820012345", "rohit.m@gn.demo", 35, ashishGupta, null);
  const neha = await mkPartner("Neha Agarwal", "Sub-DSA", "9830012345", "neha.a@gn.demo", 22, rohit, null);
  const kiran = await mkPartner("Kiran Rao", "Connector", "9840012345", "kiran.r@gn.demo", 30, ashishGupta, null);
  const builder = await mkPartner("Sai Builders & Developers", "Builder", "9850012345", "accounts@sai-builders.in", 60, null, null);
  await mkPartner("Balaji Motors (Dealer)", "Dealer", "9860012345", "sales@balajimotors.in", 25, null, null);
  await mkPartner("Omkar Patil", "Sales Agent", "9870012345", "omkar.p@gn.demo", 18, neha, null);

  /* ---------- pipeline applications ---------- */
  const apps: Record<string, any>[] = [];
  const STATUS_SEQ: [string, string][] = [
    ["lead_new", "lead"], ["lead_contacted", "lead"], ["lead_qualified", "lead"], ["lead_requirement", "lead"],
    ["app_created", "application"], ["kyc_pending", "application"], ["kyc_complete", "application"],
    ["docs_pending", "application"], ["docs_complete", "application"], ["lender_selected", "application"], ["ready_submission", "application"],
    ["submitted", "lender"], ["uw", "lender"], ["query", "lender"], ["addl_docs", "lender"], ["on_hold", "lender"],
    ["approved", "lender"], ["rejected", "lender"], ["sanction_generated", "agreement"], ["agreement_pending", "agreement"],
    ["esign_pending", "agreement"], ["agreement_completed", "agreement"], ["disb_pending", "disbursement"],
    ["disb_initiated", "disbursement"], ["disb_partial", "disbursement"], ["disb_fully", "disbursement"], ["disb_failed", "disbursement"],
    ["disb_confirmed", "completed"], ["crm_updated", "completed"], ["commission_reconciled", "completed"], ["payout_pending", "completed"], ["payout_received", "completed"], ["closed", "closed"]
  ];
  const leadFlow = STATUS_SEQ.slice(0, 4);
  const appFlow = STATUS_SEQ.slice(4, 11);
  const lenderFlow = STATUS_SEQ.slice(11, 18);
  const agreementFlow = STATUS_SEQ.slice(18, 22);
  const disbFlow = STATUS_SEQ.slice(22, 27);
  const doneFlow = STATUS_SEQ.slice(27, 33);

  const refs: string[] = [];
  let seq = 10000;
  const nextRef = () => `GN-${today.getFullYear()}-${seq++}`;

  const timelineEvent = (status: string) => {
    const curated: Record<string, string> = {
      app_created: "APPLICATION CREATED",
      kyc_complete: "KYC COMPLETE",
      docs_complete: "DOCUMENTS COMPLETE",
      lender_selected: "LENDER SELECTED",
      submitted: "APPLICATION SUBMITTED",
      uw: "UNDERWRITING STARTED",
      approved: "APPROVED",
      agreement_completed: "AGREEMENT / ESIGN COMPLETED",
      disb_initiated: "DISBURSEMENT TRIGGERED BY LENDER",
      disb_fully: "FUNDS TRANSFERRED TO BORROWER",
      disb_confirmed: "DISBURSEMENT CONFIRMED",
      crm_updated: "GROWTH NATIONS CRM UPDATED",
      commission_reconciled: "COMMISSION / PAYOUT RECONCILED"
    };
    return curated[status] ?? status.replace(/_/g, " ").toUpperCase();
  };

  const mkApp = async (cust: GnCustomer, opts: {
    status: string; daysAgo: number; amount?: number; productIdx?: number; partnerIdx?: number;
    source?: string; direct?: boolean; crossSell?: boolean; rejectedReason?: string; assignedIdx?: number; fullDisburse?: boolean
  }) => {
    const statusIdx = STATUS_SEQ.findIndex(([s]) => s === opts.status);
    const path = STATUS_SEQ.slice(0, statusIdx + 1);
    const prod = productMeta[opts.productIdx ?? Math.floor(rng() * productMeta.length)];
    const lender = lenderIds.findIndex((l) => l === prod.lenderId);
    const amount = opts.amount ?? Math.min(prod.min + (prod.max - prod.min) * 0.4, Math.round(range(300000, 9000000, rng) / 100000) * 100000);
    const created = addDays(today, -opts.daysAgo);
    const ref = nextRef();
    refs.push(ref);
    const partner = partnerIds[opts.partnerIdx ?? Math.floor(rng() * Math.min(partnerIds.length, 7))];
    const dsaCode = (await q1<{ code: string }>("SELECT code FROM gn_dsa_codes WHERE lender_id = ? ORDER BY via_parent LIMIT 1", [prod.lenderId]))?.code ?? null;
    const scheme = schemeIds.find((s, i) => i === productMeta.findIndex((m) => m.id === prod.id)) ?? null;
    const id = (await run(
      `INSERT INTO gn_applications (tenant_id, ref, customer_id, name, mobile, email, city, state, employment_type,
         monthly_income, business_turnover, business_vintage, loan_type, product_id, lender_id, scheme_id, dsa_code,
         partner_id, assigned_to, amount, tenure, purpose, source, status, stage, submitted_at, sanctioned_at, disbursed_at,
         disbursed_amount, commission_rate, commission_gross, commission_tds, commission_net, rejected_reason, is_direct_booking, is_cross_sell, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)`,
      [tenantId, ref, cust.id, cust.name, cust.mobile, `${cust.name.toLowerCase().replace(/[^a-z]/g, ".")}@gmail.com`,
       cust.city, cust.state, cust.emp, cust.monthlyIncome, cust.businessTurnover, cust.businessTurnover ? Math.max(1, Math.round(cust.businessTurnover / 2000000)) : null,
       prod.category, prod.id, prod.lenderId, scheme, dsaCode, partner,
       managerIds[opts.assignedIdx ?? Math.floor(rng() * managerIds.length)], amount, range(12, Math.min(60, 24 + Math.floor(amount / 500000)), rng),
       pick(rng, ["Business expansion", "Working capital", "New vehicle", "Home renovation", "Debt consolidation", "Inventory"]),
       opts.source ?? "dsa", opts.status, STATUS_SEQ.find(([s]) => s === opts.status)![1],
       opts.daysAgo >= 7 && !["lead_new", "lead_contacted", "lead_qualified", "lead_requirement", "app_created", "kyc_pending", "kyc_complete", "docs_pending", "docs_complete", "lender_selected", "ready_submission"].includes(opts.status) ? iso(addDays(created, 4)) : null,
       ["approved", "sanction_generated", "agreement_pending", "esign_pending", "agreement_completed", "disb_pending", "disb_initiated", "disb_partial", "disb_fully", "disb_confirmed", "disb_failed", "crm_updated", "commission_reconciled", "payout_pending", "payout_received", "closed"].includes(opts.status) ? iso(addDays(created, Math.round(opts.daysAgo * 0.55))) : null,
       opts.status === "rejected" ? null : ["disb_pending", "disb_initiated", "disb_partial", "disb_fully", "disb_confirmed", "disb_failed", "crm_updated", "commission_reconciled", "payout_pending", "payout_received", "closed"].includes(opts.status) ? iso(addDays(today, -Math.round(opts.daysAgo * 0.95))) : null,
       opts.direct ? amount : 0,
       opts.status === "rejected" ? opts.rejectedReason ?? "Income mismatch — declined by lender" : null,
       opts.direct ? 1 : 0, opts.crossSell ? 1 : 0, iso(created)]
    )).lastId;
    // timeline
    let t = 0;
    for (const [s] of path) {
      await run("INSERT INTO gn_application_timeline (tenant_id, app_id, event, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [tenantId, id, timelineEvent(s), s === "submitted" ? `Submitted to ${(await q1<{ name: string }>("SELECT name FROM gn_lenders WHERE id = ?", [prod.lenderId]))?.name}` : null,
         managerIds[Math.floor(rng() * managerIds.length)], iso(addDays(created, t++))]);
    }
    if (opts.direct) await run("INSERT INTO gn_application_timeline (tenant_id, app_id, event, note, actor, created_at) VALUES (?, ?, 'DIRECT BOOKING', 'Disbursed file logged under DSA code', ?, ?)", [tenantId, id, managerIds[0], iso(created)]);
    if (opts.crossSell) await run("INSERT INTO gn_application_timeline (tenant_id, app_id, event, note, actor, created_at) VALUES (?, ?, 'CROSS-SELL CASE', 'Borrower aged 12+ months since first disbursement', ?, ?)", [tenantId, id, managerIds[0], iso(created)]);
    apps.push({ id, ref, status: opts.status, cust, prod, lender, amount, created, daysAgo: opts.daysAgo, direct: opts.direct, fullDisburse: opts.fullDisburse });
    return id;
  };

  // Lead-stage & application-stage cases (11)
  const leadStatuses = ["lead_new", "lead_contacted", "lead_qualified", "lead_requirement", "app_created", "kyc_pending", "kyc_complete", "docs_pending", "docs_complete", "lender_selected", "ready_submission"];
  for (let i = 0; i < leadStatuses.length; i++) await mkApp(customers[i], { status: leadStatuses[i], daysAgo: i + 1 });
  await mkApp(customers[37], { status: "lender_selected", daysAgo: 4, amount: 1200000 });
  await mkApp(customers[38], { status: "lender_selected", daysAgo: 6, amount: 1800000 });
  // Lender stage (8)
  for (let i = 0; i < 8; i++) await mkApp(customers[10 + i], { status: lenderFlow[i % lenderFlow.length][0], daysAgo: 8 + i * 2 });
  // Agreement stage (3)
  for (let i = 0; i < 3; i++) await mkApp(customers[18 + i], { status: agreementFlow[i][0], daysAgo: 20 + i * 3 });
  // Rejected (2)
  await mkApp(customers[21], { status: "rejected", daysAgo: 15, rejectedReason: "FOIR exceeds 55% — declined by lender" });
  await mkApp(customers[22], { status: "rejected", daysAgo: 26, rejectedReason: "Business vintage below scheme requirement" });
  // Disbursed — 5 with payout received, 3 earned (aging), 1 disb_failed, 1 direct booking, 1 cross-sell
  for (let i = 0; i < 5; i++) await mkApp(customers[23 + i], { status: "payout_received", daysAgo: 60 + i * 15, amount: 2000000 + i * 600000 });
  await mkApp(customers[28], { status: "disb_confirmed", daysAgo: 10, amount: 3500000 });
  await mkApp(customers[29], { status: "disb_confirmed", daysAgo: 40, amount: 3200000 });
  await mkApp(customers[30], { status: "disb_confirmed", daysAgo: 75, amount: 4500000 });
  await mkApp(customers[31], { status: "disb_failed", daysAgo: 30, amount: 1500000 });
  await mkApp(customers[32], { status: "disb_confirmed", daysAgo: 380, amount: 2200000, direct: true, source: "direct_booking" });
  await mkApp(customers[33], { status: "disb_confirmed", daysAgo: 420, amount: 3500000, crossSell: true });
  await mkApp(customers[34], { status: "closed", daysAgo: 300, amount: 2400000 });
  await mkApp(customers[35], { status: "payout_pending", daysAgo: 95, amount: 4200000 });
  await mkApp(customers[36], { status: "approved", daysAgo: 5, amount: 900000 });
  // Flagship journey — ₹50,00,000 fully walked through the 13-step workflow
  await mkApp(customers[39], { status: "commission_reconciled", daysAgo: 120, amount: 5000000, productIdx: 3, fullDisburse: true });

  /* ---------- commissions on disbursed apps ---------- */
  const settings = await gnSettings(tenantId);
  let commissionCount = 0;
  const commissions: Record<string, any>[] = [];
  for (const a of apps) {
    if (!["disb_confirmed", "disb_failed", "crm_updated", "commission_reconciled", "payout_pending", "payout_received", "closed"].includes(a.status)) continue;
    const amt = a.direct || a.crossSell || a.fullDisburse ? a.amount : Math.round(a.amount * 0.96);
    const rate = a.prod.payout;
    const c = computeCommission(amt, rate, settings);
    const received = a.status === "payout_received" || a.status === "closed";
    const created = addDays(a.created, Math.round(a.daysAgo * 0.85));
    const id = (await run(
      `INSERT INTO gn_commissions (tenant_id, app_id, lender_id, scheme_id, disbursed_amount, rate, gross, gst, tds, net, status, received_at, utr, invoice_no, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, a.id, a.prod.lenderId, null, amt, rate, c.gross, c.gst, c.tds, c.net,
       received ? "received" : "earned", received ? iso(addDays(created, range(3, 15, rng))) : null,
       received ? "UTR" + String(2000000000 + Math.floor(rng() * 899999999)) : null,
       "INV-" + String(1000 + commissionCount), iso(created)]
    )).lastId;
    await run("UPDATE gn_applications SET disbursed_amount = ?, commission_rate = ?, commission_gross = ?, commission_tds = ?, commission_net = ?, fees_collected = ? WHERE id = ?",
      [amt, rate, c.gross, c.tds, c.net, Math.round(amt * (a.prod.name.includes("Personal") ? 0.02 : 0.01)), a.id]);
    commissions.push({ id, appId: a.id, amount: amt, gross: c.gross, net: c.net, received, partnerId: (await q1<{ partner_id: number }>("SELECT partner_id FROM gn_applications WHERE id = ?", [a.id]))?.partner_id, ref: a.ref });
    commissionCount++;
  }

  /* ---------- customer fees on disbursed cases ---------- */
  for (const a of apps.filter((x) => ["disb_confirmed", "payout_pending", "payout_received", "closed"].includes(x.status))) {
    await run("INSERT INTO gn_customer_fees (tenant_id, app_id, processing, insurance, rto, other, disbursed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [tenantId, a.id, Math.round(a.amount * 0.01), a.prod.name === "Commercial Vehicle" ? Math.round(a.amount * 0.02) : 0,
       a.prod.name === "Commercial Vehicle" ? range(1500, 5000, rng) : 0, range(0, 2000, rng), iso(addDays(a.created, Math.round(a.daysAgo * 0.8)))]);
  }

  /* ---------- payout batches ---------- */
  const paidComms = commissions.filter((c) => c.received).slice(0, 5);
  const batch1 = paidComms.slice(0, 2);
  const batch2 = paidComms.slice(2, 4);
  const batch3 = paidComms.slice(4);
  const mkBatch = async (comms: any[], payeeIdx: number, status: string, daysAgo: number, mode: string, utr?: string) => {
    if (!comms.length) return;
    const gross = comms.reduce((s, c) => s + c.gross, 0);
    const tds = Math.round(gross * 0.02);
    const net = gross - tds;
    const share = Math.round((net * 60) / 100);
    (await run(
      `INSERT INTO gn_payout_batches (tenant_id, batch_ref, payee_type, payee_id, payee_name, loans, gross, tds, net, splits, status, mode, utr, paid_at, created_by, created_at)
       VALUES (?, ?, 'Partner', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, `PB-${today.getFullYear()}-${1000 + Math.floor(rng() * 900)}`, partnerIds[payeeIdx],
       (await q1<{ name: string }>("SELECT name FROM gn_partners WHERE id = ?", [partnerIds[payeeIdx]]))?.name,
       JSON.stringify(comms.map((c) => c.ref)), gross, tds, net,
       JSON.stringify({ [(await q1<{ name: string }>("SELECT name FROM gn_partners WHERE id = ?", [partnerIds[payeeIdx]]))?.name ?? "Partner"]: share, "Growth Nations": net - share, split_pct: 60 }),
       status, mode, utr ?? null, status === "paid" ? iso(addDays(today, -daysAgo)) : null, managerIds[1], iso(addDays(today, -daysAgo))]
    )).lastId;
  };
  await mkBatch(batch1, 0, "paid", 20, "NEFT", "UTR" + String(3000000000 + Math.floor(rng() * 899999999)));
  await mkBatch(batch2, 1, "approved", 8, "IMPS");
  await mkBatch(batch3, 2, "draft", 2, "NEFT");

  /* ---------- expenses ---------- */
  const expenseDefs: [string, string, number, boolean][] = [
    ["Office rent — Gurugram HQ", "rent", 120000, true], ["Verification API credits", "technology", 38500, true],
    ["Sales team incentives", "payroll", 85000, true], ["Google Ads — June run", "marketing", 60000, true],
    ["Telecom & internet", "utilities", 12500, true], ["Legal & compliance retainer", "professional", 30000, false],
    ["WhatsApp Business API", "technology", 4800, true], ["Stationery & printing", "operations", 6200, false]
  ];
  for (const [title, cat, amount, paid] of expenseDefs) {
    await run("INSERT INTO gn_expenses (tenant_id, title, category, vendor, amount, paid, status, expense_date) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))",
      [tenantId, title, cat, null, amount, paid ? 1 : 0, paid ? "paid" : "approved", `-${range(1, 40, rng)} days`]);
  }
  /* Pending claims awaiting approval in the Utility → Approvals hub */
  const claimDefs: [string, string, string, number][] = [
    ["Client visit — Pune office", "conveyance", "Cab + tolls", 1850],
    ["Fuel — field collection drive", "conveyance", "Fuel", 2400],
    ["DSA onboarding lunch", "expense", "Team outing", 4600],
    ["Courier — sanction letters", "expense", "Speed post", 720],
    ["Train fare — branch audit", "conveyance", "IRCTC", 3150],
    ["Printer toner — operations", "expense", "Stationery", 1900]
  ];
  for (const [title, claimType, vendor, amount] of claimDefs) {
    await run("INSERT INTO gn_expenses (tenant_id, title, category, vendor, amount, paid, claim_type, status, claimed_by, expense_date) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?, datetime('now', ?))",
      [tenantId, title, claimType === "conveyance" ? "travel" : "operations", vendor, amount, claimType, pick(rng, managerIds), `-${range(0, 6, rng)} days`]);
  }

  /* ---------- marketing campaigns ---------- */
  const campaignDefs: [string, string, number, number, number, number, number][] = [
    ["Business Loan — Meta LAL", "meta", 85000, 420, 38, 9600000, 19000000],
    ["Home Loan — Google Search", "google", 120000, 260, 22, 7400000, 15000000],
    ["CV Finance — Meta Lead Ads", "meta", 65000, 180, 15, 5100000, 9800000],
    ["Gold Loan — WhatsApp Blast", "whatsapp", 18000, 320, 12, 2100000, 4200000],
    ["Personal Loan — Instagram", "meta", 45000, 540, 28, 3600000, 7100000],
    ["LAP — Google Display", "google", 40000, 95, 8, 2200000, 3900000]
  ];
  for (const [name, channel, spend, leads, applications, disbursed, revenue] of campaignDefs) {
    await run("INSERT INTO gn_campaigns (tenant_id, name, channel, spend, leads, applications, disbursed_amount, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')",
      [tenantId, name, channel, spend, leads, applications, disbursed, iso(addMonths(today, -2)), iso(today), ]);
  }

  /* ---------- marketing workflows (workflow builder) ---------- */
  const workflowDefs: [string, string, string, string, any[], string][] = [
    ["Lead Nurture — Instant Response", "lead_captured", "Any new lead that lands from any channel", "score_round_robin",
      [{ type: "whatsapp", template_id: null, title: "Welcome message" }, { type: "task", title: "Call lead within 30 minutes" }], "active"],
    ["Home Loan — Document Chase", "app_created", "Application created but KYC/documents incomplete for 48h", "round_robin",
      [{ type: "whatsapp", template_id: null, title: "Document reminder" }, { type: "email", template_id: null, title: "Missing document email" }, { type: "task", title: "Telecall follow-up" }], "active"],
    ["Post-Disbursement Onboarding", "milestone_reached", "Loan disbursed — kick off welcome + insurance cross-sell", "specific_pool",
      [{ type: "whatsapp", template_id: null, title: "Welcome aboard" }, { type: "task", title: "Cross-sell call" }], "active"],
    ["Missed-EMI Alert", "milestone_reached", "EMI missed — trigger collection workflow", "manual",
      [{ type: "whatsapp", template_id: null, title: "Payment reminder" }, { type: "task", title: "Collection agent call" }], "paused"],
    ["DSA Lead Routing", "lead_captured", "DSA-sourced leads route to nearest branch pool", "specific_pool",
      [{ type: "task", title: "Branch assignment" }, { type: "whatsapp", template_id: null, title: "Assigned branch intro" }], "draft"]
  ];
  for (const [name, trigger, triggerDetail, route, actions, status] of workflowDefs) {
    await run("INSERT INTO gn_workflows (tenant_id, name, trigger, trigger_detail, route, actions, status, created_by, run_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [tenantId, name, trigger, triggerDetail, route, JSON.stringify(actions), status, managerIds[0], range(0, 240, rng)]);
  }

  /* ---------- IVR menus + call logs ---------- */
  const ivrDefs: [string, string, any[], string][] = [
    ["Main Line — Sales & Support", "Welcome to Growth Nations Finance. Press 1 for new loan enquiries, 2 for existing loan, 3 for collections, 4 to speak to support.",
      [{ key: "1", label: "New Loan Enquiry", route: "Telecalling" }, { key: "2", label: "Existing Loan", route: "Support" }, { key: "3", label: "Collections", route: "Collections" }, { key: "4", label: "Support", route: "Support" }], "Telecalling"],
    ["Collection Line", "Thank you for calling Growth Nations. For payment assistance press 1, to speak to your collection officer press 2.",
      [{ key: "1", label: "Payment Assistance", route: "Collections" }, { key: "2", label: "Collection Officer", route: "Collections" }], "Collections"],
    ["DSA Partner Line", "Welcome partner. Press 1 for new DSA onboarding, 2 for payout status, 3 for scheme information.",
      [{ key: "1", label: "DSA Onboarding", route: "Partnership" }, { key: "2", label: "Payout Status", route: "Finance" }, { key: "3", label: "Scheme Info", route: "Masters" }], "Partnership"]
  ];
  const ivrMenuIds: number[] = [];
  for (const [name, greeting, menuOptions, fallback] of ivrDefs) {
    const id = (await run("INSERT INTO gn_ivr_menus (tenant_id, name, greeting, menu_options, fallback, status) VALUES (?, ?, ?, ?, ?, 'active')",
      [tenantId, name, greeting, JSON.stringify(menuOptions), fallback])).lastId;
    ivrMenuIds.push(id);
  }
  const callOutcomes = ["connected", "connected", "connected", "no_answer", "busy", "callback"];
  for (let i = 0; i < 18; i++) {
    const menuId = pick(rng, ivrMenuIds);
    const menu = ivrDefs.find((_, idx) => ivrMenuIds[idx] === menuId)!;
    const option = pick(rng, menu[2]);
    const outcome = pick(rng, callOutcomes);
    await run("INSERT INTO gn_call_logs (tenant_id, call_id, caller, ivr_menu_id, route, outcome, duration_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))",
      [tenantId, `IVR-${new Date().getFullYear()}-${String(1001 + i)}`, "9" + String(100000000 + Math.floor(rng() * 899999999)), menuId, option.route, outcome,
       outcome === "connected" ? range(25, 180, rng) : 0, `-${range(0, 14, rng)} days`]);
  }

  /* ---------- inbox — templates ---------- */
  const templateDefs: [string, string, string, string, string[]][] = [
    ["Welcome to Growth Nations", "whatsapp", "onboarding", "Hi {{name}}! Welcome to Growth Nations Finance 🎉 Our relationship manager will call you shortly to understand your loan requirement.", ["name"]],
    ["Document Reminder", "whatsapp", "transactional", "Dear {{name}}, we still need your {{document}} to process your {{loan_type}} application ({{ref}}). Please upload it at your earliest convenience.", ["name", "document", "loan_type", "ref"]],
    ["KYC Complete", "whatsapp", "transactional", "Great news {{name}}! Your KYC is complete. Our credit team is now reviewing your application {{ref}}.", ["name", "ref"]],
    ["Loan Approved 🎉", "whatsapp", "transactional", "Congratulations {{name}}! Your {{loan_type}} loan of {{amount}} has been approved. Our team will share the sanction letter shortly.", ["name", "loan_type", "amount"]],
    ["Disbursement Update", "whatsapp", "transactional", "Your loan of {{amount}} has been disbursed to your account. Thank you for choosing Growth Nations!", ["amount"]],
    ["Payment Reminder", "sms", "collection", "Dear {{name}}, your EMI of {{amount}} for loan {{loan_no}} is due on {{due_date}}. Please ensure sufficient balance.", ["name", "amount", "loan_no", "due_date"]],
    ["Payout Received", "email", "transactional", "Dear {{partner}}, your commission payout of {{amount}} for {{month}} has been credited to your account. Statement attached.", ["partner", "amount", "month"]],
    ["Happy Anniversary", "whatsapp", "promotional", "It's been {{years}} years with Growth Nations, {{name}}! Check your top-up eligibility with a simple call.", ["years", "name"]]
  ];
  const templateIds: number[] = [];
  for (const [name, category, purpose, body, variables] of templateDefs) {
    const id = (await run("INSERT INTO gn_message_templates (tenant_id, name, category, purpose, body, variables, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?)",
      [tenantId, name, category, purpose, body, JSON.stringify(variables), managerIds[0]])).lastId;
    templateIds.push(id);
  }

  /* ---------- inbox — whatsapp drips ---------- */
  const dripDefs: [string, string, string, number, string, string][] = [
    ["New Lead Instant Nurture", "lead_captured", "all_leads", templateIds[0], "immediate", "active"],
    ["Home Loan Doc Chase", "app_created", "no_application", templateIds[1], "daily", "active"],
    ["Disbursement Celebration", "post_disbursement", "disb_only", templateIds[4], "immediate", "active"],
    ["EMI Reminder — Collections", "missed_emi", "overdue", templateIds[5], "daily", "active"],
    ["Anniversary Cross-sell", "inquiry", "all_leads", templateIds[7], "custom", "paused"]
  ];
  for (const [name, trigger, audience, templateId, schedule, status] of dripDefs) {
    await run("INSERT INTO gn_whatsapp_drips (tenant_id, name, trigger, audience, template_id, schedule, custom_hour, status, sent_count, delivered_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [tenantId, name, trigger, audience, templateId, schedule, schedule === "custom" ? 10 : null, status, range(40, 600, rng), range(30, 500, rng)]);
  }

  /* ---------- inbox — message feed ---------- */
  const inboxDefs: [string, string, string | null, string | null, string | null, string, string, number | null][] = [
    ["in", "whatsapp", "9" + String(100000000 + Math.floor(rng() * 899999999)), null, "Home loan query", "Hi, I saw your ad for home loans. What's the current interest rate for a 50 lakh loan?", "lead", null],
    ["in", "whatsapp", "9" + String(100000000 + Math.floor(rng() * 899999999)), null, "Business loan docs", "Which documents do I need for a business loan? I have GST registration.", "lead", null],
    ["in", "sms", "9" + String(100000000 + Math.floor(rng() * 899999999)), null, null, "Please call me back tomorrow morning.", "lead", null],
    ["out", "whatsapp", null, "9" + String(100000000 + Math.floor(rng() * 899999999)), "Document Reminder", "Dear customer, we still need your Bank Statement to process your Business Loan application (GN-2026-10021).", "application", null],
    ["out", "whatsapp", null, "9" + String(100000000 + Math.floor(rng() * 899999999)), "Loan Approved 🎉", "Congratulations! Your Home Loan of ₹45,00,000 has been approved. Our team will share the sanction letter shortly.", "application", null],
    ["in", "call", "9" + String(100000000 + Math.floor(rng() * 899999999)), null, "IVR callback request", "Caller pressed 1 (New Loan Enquiry) → routed to Telecalling.", "lead", null],
    ["in", "email", "rajesh@buildcon.in", null, "Payout query", "When will the July commission be credited for my DSA code?", "partner", null],
    ["out", "email", null, "rajesh@buildcon.in", "Payout Received", "Dear Rajesh, your commission payout of ₹1,85,000 for 2026-07 has been credited.", "partner", null],
    ["in", "whatsapp", "9" + String(100000000 + Math.floor(rng() * 899999999)), null, "EMI date change", "Can I change my EMI date to the 5th of every month?", "application", null],
    ["out", "whatsapp", null, "9" + String(100000000 + Math.floor(rng() * 899999999)), "Payment Reminder", "Dear customer, your EMI of ₹28,400 for loan LN-2026-0102 is due on 2026-08-15.", "application", null],
    ["in", "whatsapp", "9" + String(100000000 + Math.floor(rng() * 899999999)), null, "Top-up eligibility", "I want to check if I'm eligible for a top-up on my existing loan.", "lead", null],
    ["out", "whatsapp", null, "9" + String(100000000 + Math.floor(rng() * 899999999)), "Welcome to Growth Nations", "Hi! Welcome to Growth Nations Finance 🎉 Our relationship manager will call you shortly.", "lead", null],
    ["in", "call", "9" + String(100000000 + Math.floor(rng() * 899999999)), null, "IVR collections", "Caller pressed 1 (Payment Assistance) → routed to Collections.", "application", null],
    ["in", "whatsapp", "9" + String(100000000 + Math.floor(rng() * 899999999)), null, "Agreement status", "Has my agreement been e-signed by the lender yet?", "application", null],
    ["out", "whatsapp", null, "9" + String(100000000 + Math.floor(rng() * 899999999)), "Disbursement Update", "Your loan of ₹32,00,000 has been disbursed to your account. Thank you for choosing Growth Nations!", "application", null]
  ];
  for (const [direction, channel, fromContact, toContact, subject, body, relatedType, relatedId] of inboxDefs) {
    await run("INSERT INTO gn_inbox_messages (tenant_id, direction, channel, from_contact, to_contact, subject, body, related_type, related_id, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))",
      [tenantId, direction, channel, fromContact, toContact, subject, body, relatedType, relatedId,
       direction === "in" ? (rng() < 0.6 ? "unread" : "read") : "sent", managerIds[0], `-${range(0, 10, rng)} days`]);
  }

  /* ---------- documentation ---------- */
  const docArticleDefs: [string, string, string][] = [
    ["Getting Started", "Welcome to Growth Nations — DSA Quickstart", "This guide walks your team through the first 30 days on the platform: activating your DSA code, uploading KYC documents, and submitting your first loan application. Every screen in the platform is database-backed demo data, so you can explore freely without affecting production records."],
    ["Getting Started", "How to Create a Lead", "Open CRM → Leads → New Lead. Enter the customer's mobile number, requirement and city. The lead is instantly routed to your telecalling pool per your active workflow. Leads captured via Meta, Google and WhatsApp land here automatically in the demo environment."],
    ["Loan Origination", "Creating a Loan Application", "From a lead, click 'Create Application' to start the LOS journey: KYC → Documents → Credit → BRE → Underwriting → Approval → Sanction → KFS → Agreement → eSign → Disbursement. Each stage is tracked in the application timeline with SLA timers."],
    ["Loan Origination", "Understanding the Lender Match", "The matcher evaluates your customer's profile against every active lender product and returns eligible / maybe / not eligible with reasons. Eligibility depends on amount, tenure, income, vintage, turnover, geography and your configured scheme rules."],
    ["Disbursement", "Reading the Disbursement Dashboard", "The disbursement page shows sanctioned-but-undisbursed files, lender-wise breakups and aging. Once a lender confirms disbursal, the status moves to 'Disbursement Confirmed' and the Growth Nations CRM is updated automatically."],
    ["Commissions", "Commission & Payout Reconciliation", "Every disbursed loan earns commission at your configured payout rate. Payouts are batched monthly, reconciled against bank statements, and each transaction is audit-logged. The Wallet shows your earned, pending and received balance."],
    ["Compliance", "KFS & APR Disclosure", "Every loan must have a Key Fact Statement generated before acceptance, with the APR calculated and all charges validated. If required information is missing, the platform shows a Compliance Blocker — no hidden charges are ever allowed."],
    ["Support", "Raising a Support Ticket", "Use Help & FAQ → New Ticket to raise a support request. Tickets are triaged by priority and visible in the Help & FAQ dashboard with SLA status."]
  ];
  for (const [category, title, content] of docArticleDefs) {
    await run("INSERT INTO gn_docs (tenant_id, title, slug, category, content, updated_by) VALUES (?, ?, ?, ?, ?, ?)",
      [tenantId, title, title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), category, content, managerIds[0]]);
  }

  /* ---------- help & faq ---------- */
  const faqDefs: [string, string, string][] = [
    ["General", "What is Growth Nations?", "Growth Nations is India's intelligent lending operating system — CRM, LOS, LMS, credit, BRE, underwriting, payments, collections, compliance and AI in one platform."],
    ["General", "Is the demo data real?", "No. All customer, lead, application, loan and payment data is synthetic demo data generated for demonstration purposes only. Never use real personal or financial information."],
    ["Leads", "How do I capture a lead?", "Create a lead manually in CRM → Leads, or via bulk import, or through campaigns — Meta, Google, WhatsApp and walk-in sources are supported."],
    ["Applications", "How do I submit an application to a lender?", "Complete KYC, documents and credit checks, run the lender match, select the best offer and click Submit. The application is then tracked through underwriting, approval and sanction."],
    ["Disbursement", "When is commission earned?", "Commission is earned when a loan is fully disbursed and the lender confirms disbursal. It becomes receivable at month-end and is paid out per your payout schedule."],
    ["Payments", "How does payment reconciliation work?", "Bank/gateway transactions are imported, normalized, matched to loans by reference/amount/customer, and auto-reconciled. Exceptions land in a human-review queue with full audit."],
    ["Compliance", "What is a Compliance Blocker?", "When required KFS/APR information is missing before acceptance, the platform blocks the action and shows a Compliance Blocker so no hidden charges are ever passed to a customer."],
    ["Security", "Who can see customer data?", "Access is controlled by role-based permissions. Every sensitive operation is audit-logged with who, what, when, IP and before/after values."],
    ["Support", "How do I raise a complaint?", "Use Help & FAQ → New Ticket. You can track the ticket status and resolution from the same page."],
    ["AI", "What can NEXUS AI do?", "NEXUS AI can search, analyze, summarize, compare, recommend and draft. It never autonomously approves, rejects, disburses or modifies financial records — human confirmation is always required."]
  ];
  for (const [category, question, answer] of faqDefs) {
    await run("INSERT INTO gn_faqs (tenant_id, question, answer, category, helpful_yes, helpful_no) VALUES (?, ?, ?, ?, ?, ?)",
      [tenantId, question, answer, category, range(1, 60, rng), range(0, 12, rng)]);
  }

  /* ---------- support tickets ---------- */
  const ticketDefs: [string, string, string, string, string][] = [
    ["Payout not reflecting in wallet", "My July payout shows as processed but the amount is not in my wallet balance yet.", "high", "Payout", "in_progress"],
    ["Lender file rejected — need reason", "SBI rejected my file but the reason is not visible on the application timeline.", "urgent", "Application", "open"],
    ["Unable to upload PAN card", "The document upload keeps failing for the PAN card on this application.", "medium", "Documents", "open"],
    ["KFS amount mismatch", "The KFS shows a processing fee higher than the scheme table.", "high", "Compliance", "in_progress"],
    ["DSA code not mapping to my partner", "My applications are not attributing commission to my DSA code.", "medium", "Commission", "open"],
    ["Login issue on mobile", "I cannot log in on my phone after the last update.", "low", "Login", "resolved"]
  ];
  for (const [subject, message, priority, category, status] of ticketDefs) {
    await run("INSERT INTO gn_support_tickets (tenant_id, subject, message, priority, category, status, created_by, assigned_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))",
      [tenantId, subject, message, priority, category, status, managerIds[0], pick(rng, managerIds), `-${range(0, 8, rng)} days`]);
  }

  /* ---------- changelog ---------- */
  const changelogDefs: [string, string, string, string, number][] = [
    ["2.4.0", "Command Center + Bulk Loan Application Processing", "Added the GN Command Center (applicant funnel, lender matching, disbursement tracking), the bulk application engine with 500-applicant demo batches, and the API Center with mock provider endpoints.", "feature", 0],
    ["2.3.0", "Utility Dashboard", "Added the Utility hub — pending approvals, bulk lead assign, document and import shortcuts.", "feature", 4],
    ["2.2.1", "Scheme form extended", "Scheme forms now support banker identity, property area, TAT, rate notes, BT rules, enquiries and city tiers.", "improvement", 7],
    ["2.2.0", "Recycle Bin", "Deleted records now move to a Recycle Bin with one-click restore — nothing is permanently lost by accident.", "feature", 9],
    ["2.1.0", "Inbox, Drips & Templates", "Added the unified inbox with WhatsApp/SMS/email threads, drip campaigns and the template library.", "feature", 11],
    ["2.0.5", "Security hardening", "Tenant isolation verified across all GN modules; sensitive operations audit-logged with before/after.", "security", 14],
    ["2.0.0", "Payment Reconciliation Center", "Bank transaction import, auto-match, exception queue and reversals with immutable financial history.", "feature", 20],
    ["1.9.0", "KFS / APR Engine", "Key Fact Statement generation with APR calculation and compliance blockers on missing disclosures.", "feature", 28]
  ];
  for (const [version, title, content, category, daysAgo] of changelogDefs) {
    await run("INSERT INTO gn_changelog (tenant_id, version, title, content, category, released_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))",
      [tenantId, version, title, content, category, `-${daysAgo} days`]);
  }

  /* ---------- HR ---------- */
  const leaveTypes = ["casual", "sick", "privileged", "unpaid"];
  for (let i = 0; i < 8; i++) {
    const u = pick(rng, managerIds);
    const from = addDays(today, range(-40, 20, rng));
    const days = range(1, 4, rng);
    const status = i === 0 ? "pending" : pick(rng, ["approved", "approved", "pending", "rejected"]);
    await run("INSERT INTO gn_leave_requests (tenant_id, user_id, leave_type, from_date, to_date, days, reason, status, decided_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [tenantId, u, pick(rng, leaveTypes), iso(from), iso(addDays(from, days - 1)), days, pick(rng, ["Family function", "Medical", "Personal work", "Travel"]),
       status, pick(rng, managerIds), iso(addDays(from, -5))]);
  }
  for (let d = 0; d < 25; d++) {
    const date = iso(addDays(today, -d));
    if (new Date(date).getDay() === 0) continue;
    for (const u of managerIds.slice(0, 6)) {
      await run("INSERT OR IGNORE INTO gn_attendance (tenant_id, user_id, date, check_in, check_out, status) VALUES (?, ?, ?, ?, ?, ?)",
        [tenantId, u, date, "09:" + String(10 + Math.floor(rng() * 45)), "18:" + String(0 + Math.floor(rng() * 40)), rng() < 0.08 ? "leave" : rng() < 0.04 ? "half_day" : "present"]);
    }
  }
  const payrollBases: [string, number][] = [["tenant_admin", 120000], ["sales_manager", 70000], ["credit_manager", 95000], ["underwriter", 65000], ["collection_manager", 55000], ["operations", 55000], ["compliance_officer", 75000], ["finance", 60000], ["branch_admin", 90000]];
  for (const [role, gross] of payrollBases) {
    await run("INSERT OR REPLACE INTO gn_payroll (tenant_id, user_id, month, basic, hra, allowance, gross, tds, net, status) SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, 'generated' FROM users WHERE role = ? AND tenant_id = ?",
      [tenantId, iso(today).slice(0, 7), Math.round(gross * 0.5), Math.round(gross * 0.3), Math.round(gross * 0.2), gross, Math.round(gross * 0.02), gross - Math.round(gross * 0.02), role, tenantId]);
  }
  const candidateDefs: [string, string, string][] = [
    ["Ananya Singh", "Credit Analyst", "Sourced via Naukri"], ["Rohan Kapoor", "Collection Manager", "Referral"],
    ["Sneha Iyer", "Field Executive", "Meta job ad"], ["Vikas Chauhan", "Telecaller", "Walk-in"], ["Priyanka Das", "Operations Executive", "Referral"]
  ];
  for (const [name, position, source] of candidateDefs) {
    await run("INSERT INTO gn_candidates (tenant_id, name, position, phone, email, source, stage) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [tenantId, name, position, "9" + String(100000000 + Math.floor(rng() * 899999999)), name.toLowerCase().replace(/[^a-z]/g, ".") + "@gmail.com", source, pick(rng, ["applied", "screening", "interview", "offered"])]);
  }

  /* ---------- documents ---------- */
  const docDefs: [string, string][] = [
    ["customer", "pan"], ["customer", "aadhaar"], ["customer", "bank_statement"], ["customer", "itr"],
    ["application", "sanction_letter"], ["application", "agreement"], ["application", "kfs"], ["partner", "pan"],
    ["partner", "gstin"], ["partner", "bank_cancelled_cheque"]
  ];
  for (const [etype, docType] of docDefs) {
    const eid = etype === "application" ? pick(rng, apps.filter((a) => a.id)).id : etype === "partner" ? pick(rng, partnerIds) : pick(rng, customers).id;
    await run("INSERT INTO gn_documents (tenant_id, entity_type, entity_id, doc_type, name, status, uploaded_by, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))",
      [tenantId, etype, eid, docType, docType.replace(/_/g, " ") + ".pdf", pick(rng, ["verified", "verified", "under_review", "pending"]), pick(rng, managerIds), pick(rng, managerIds), `-${range(1, 30, rng)} days`]);
  }

  /* ---------- tasks ---------- */
  const taskDefs: [string, string | null, string, string, number][] = [
    ["Follow up KYC documents — Ashish Gupta", refs[6] ?? null, "high", "pending", 0],
    ["Call Omkar — interested in Business Loan", refs[0] ?? null, "high", "pending", 0],
    ["Collect signed sanction letter from borrower", refs[19] ?? null, "medium", "in_progress", 1],
    ["Verify GSTIN for Neha Agarwal's file", refs[10] ?? null, "medium", "in_progress", 2],
    ["Prepare lender file for submission — SBI", refs[8] ?? null, "high", "pending", 0],
    ["Banker follow-up: Hero FinCorp underwriting", refs[12] ?? null, "low", "completed", 3],
    ["Cross-sell call — top-up offer to existing borrower", null, "low", "pending", 4],
    ["Reconcile July payout batch with bank statement", null, "high", "in_progress", 5]
  ];
  for (const [title, linked, priority, status, assignedIdx] of taskDefs) {
    await run("INSERT INTO gn_tasks (tenant_id, title, linked_to, priority, status, due_at, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?, ?)",
      [tenantId, title, linked, priority, status, `+${range(1, 6, rng)} days`, managerIds[assignedIdx % managerIds.length], managerIds[0]]);
  }

  /* ---------- roles & permission grids (admin-toggable, DB-backed) ---------- */
  const ROLE_DEFS: [string, string, string, string | null, string | null][] = [
    ["super_admin", "Super Admin", "staff", "Owner", null],
    ["tenant_admin", "Tenant Admin", "staff", "Head of Operations", null],
    ["branch_admin", "Branch Admin", "staff", "Branch Head", null],
    ["sales_manager", "Sales Manager", "staff", "Sales Head", null],
    ["telecaller", "Telecaller", "staff", "Inside Sales", null],
    ["field_executive", "Field Executive", "staff", "Field Sales", null],
    ["credit_analyst", "Credit Analyst", "staff", "Credit", null],
    ["credit_manager", "Credit Manager", "staff", "Credit Head", null],
    ["underwriter", "Underwriter", "staff", "Credit", null],
    ["operations", "Operations", "staff", "Operations", null],
    ["collection_manager", "Collection Manager", "staff", "Collections", null],
    ["collection_agent", "Collection Agent", "staff", "Collections", null],
    ["dsa", "DSA Partner", "partner", null, "DSA"],
    ["finance", "Finance", "staff", "Finance", null],
    ["auditor", "Auditor", "staff", "Audit", null],
    ["compliance_officer", "Compliance Officer", "staff", "Compliance", null],
    ["customer_support", "Customer Support", "staff", "Support", null],
    ["customer", "Customer", "partner", null, "Customer"]
  ];
  let roleCount = 0;
  for (const [code, name, kind, designation, partnerType] of ROLE_DEFS) {
    await run("INSERT OR REPLACE INTO gn_roles (tenant_id, code, name, kind, designation, partner_type, is_system) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [tenantId, code, name, kind, designation, partnerType]);
    await seedRolePermissions(tenantId, code);
    roleCount++;
  }

  const disbursedTotal = apps.filter((a) => a.direct || ["disb_confirmed", "disb_failed", "crm_updated", "commission_reconciled", "payout_pending", "payout_received", "closed"].includes(a.status)).reduce((s, a) => s + (a.direct ? a.amount : Math.round(a.amount * 0.96)), 0);
  console.log(`[GN SEED] lenders=${lenderIds.length} products=${productIds.length} schemes=${schemeIds.length} partners=${partnerIds.length} apps=${apps.length} commissions=${commissionCount} roles=${roleCount} disbursed=${inr(disbursedTotal)}`);

  await seedCommandCenter(tenantId, rng, userIds);
}

/* ================= Command Center + Bulk demo data ================= */

async function seedCommandCenter(tenantId: number, rng: GnRng, userIds: number[]) {
  const uid = userIds[0] ?? 1;
  const t = tenantId;

  /* API providers (all categories, clearly labelled demo/sandbox) */
  const apiCats: [string, string, string][] = [
    ["otp", "OTP / SMS", "demo_connected"], ["kyc", "KYC / e-KYC", "demo_connected"], ["pan", "PAN Verification", "demo_connected"],
    ["credit", "Credit Bureau", "demo_connected"], ["gst", "GST", "sandbox_ready"], ["udyam", "Udyam", "sandbox_ready"],
    ["bank", "Bank Statement / Account Verification", "sandbox_ready"], ["esign", "eSign", "sandbox_ready"],
    ["lender", "Lender APIs", "sandbox_ready"], ["disbursement", "Disbursement", "not_connected"],
    ["document", "Document Verification", "sandbox_ready"], ["email", "Email / WhatsApp", "not_connected"]
  ];
  for (const [cat, label, status] of apiCats) {
    await run("INSERT INTO gn_api_providers (tenant_id, category, name, status, env, endpoint) VALUES (?, ?, ?, ?, 'demo', ?)",
      [t, cat, `Demo ${label} Provider`, status, `https://api.demo-provider.in/${cat}`]);
  }
  for (let i = 0; i < 8; i++) {
    await run("INSERT INTO gn_api_logs (tenant_id, provider, category, action, endpoint, status, request_id, latency_ms, response, environment) VALUES (?, 'Demo KYC Provider', 'kyc', 'verifyPAN', 'https://api.demo-provider.in/kyc', 'success', ?, ?, ?, 'demo')",
      [t, `REQ-SEED-${100000 + i}`, 60 + Math.floor(rng() * 220), JSON.stringify({ ok: true, reference: `KYC-DEMO-${100000 + i}` })]);
  }
  await run("INSERT INTO gn_webhook_events (tenant_id, provider, event, request_id, payload, status, processed_at) VALUES (?, 'Demo Lender', 'APPLICATION_SUBMITTED', ?, '{}', 'processed', datetime('now'))", [t, `WH-SEED-${Date.now()}`]);
  await run("INSERT INTO gn_webhook_events (tenant_id, provider, event, request_id, payload, status, processed_at) VALUES (?, 'Demo Lender', 'APPROVED', ?, '{}', 'processed', datetime('now'))", [t, `WH-SEED-${Date.now()}`]);

  /* 12 relational demo applicants at different pipeline stages */
  const stories: Record<string, any>[] = [
    { name: "Priya Shah", mobile: "9822001101", pan: "BMJPS1234A", dob: "1992-06-14", city: "Mumbai", state: "Maharashtra", employment_type: "Salaried", employer: "TCS Ltd", monthly_income: 95000, loan_type: "Personal Loan", loan_amount: 800000, tenure: 36, stage: "payout", gender: "Female" },
    { name: "Amit Patel", mobile: "9822001102", pan: "BMJPA2345B", dob: "1988-11-02", city: "Ahmedabad", state: "Gujarat", employment_type: "Self-employed", business_name: "Amit Textiles", business_vintage: 9, annual_turnover: 36000000, monthly_income: 300000, loan_type: "Home Loan", loan_amount: 6000000, tenure: 240, stage: "disb", gender: "Male" },
    { name: "Sneha Reddy", mobile: "9822001103", pan: "BMJPR3456C", dob: "1990-03-21", city: "Hyderabad", state: "Telangana", employment_type: "Business Owner", business_name: "Sneha Pharma", business_type: "Healthcare", business_vintage: 6, annual_turnover: 52000000, monthly_income: 420000, loan_type: "Business Loan", loan_amount: 2500000, tenure: 48, stage: "uw", gender: "Female" },
    { name: "Vikram Singh", mobile: "9822001104", pan: "BMJPV4567D", dob: "1993-09-30", city: "Delhi", state: "Delhi", employment_type: "Self-employed", business_name: "Vikram Logistics", business_vintage: 4, annual_turnover: 14000000, monthly_income: 120000, loan_type: "Vehicle Loan", loan_amount: 600000, tenure: 48, stage: "docs", gender: "Male" },
    { name: "Pooja Iyer", mobile: "9822001105", pan: "BMJPI5678E", dob: "1985-01-12", city: "Chennai", state: "Tamil Nadu", employment_type: "Business Owner", business_name: "Iyer Constructions", business_vintage: 11, annual_turnover: 88000000, monthly_income: 650000, loan_type: "Loan Against Property", loan_amount: 4000000, tenure: 120, stage: "approved", gender: "Female" },
    { name: "Rohit Verma", mobile: "9822001106", pan: "BMJPR6789F", dob: "1991-07-25", city: "Lucknow", state: "Uttar Pradesh", employment_type: "Self-employed", business_name: "Verma Trading Co", business_type: "Trading", business_vintage: 3, annual_turnover: 19000000, monthly_income: 160000, loan_type: "Business Loan", loan_amount: 1800000, tenure: 36, stage: "app", gender: "Male" },
    { name: "Kavita Joshi", mobile: "9822001107", pan: "BMJPR7890G", dob: "1995-12-05", city: "Pune", state: "Maharashtra", employment_type: "Salaried", employer: "Infosys Ltd", monthly_income: 72000, loan_type: "Personal Loan", loan_amount: 500000, tenure: 24, stage: "kyc", gender: "Female" },
    { name: "Arjun Nair", mobile: "9822001108", pan: "BMJPN8901H", dob: "1994-04-18", city: "Kochi", state: "Kerala", employment_type: "Business Owner", business_name: "Nair Engineering", business_vintage: 2, annual_turnover: 12000000, monthly_income: 95000, loan_type: "Equipment Loan", loan_amount: 3000000, tenure: 60, stage: "consent", gender: "Male" },
    { name: "Neha Gupta", mobile: "9822001109", pan: "BMJPG9012I", dob: "1989-08-08", city: "Jaipur", state: "Rajasthan", employment_type: "Self-employed", business_name: "Gupta Jewellers", business_vintage: 7, annual_turnover: 45000000, monthly_income: 380000, loan_type: "Home Loan", loan_amount: 3500000, tenure: 240, stage: "rejected", gender: "Female" },
    { name: "Sanjay Das", mobile: "9822001110", pan: "BMJPS0123J", dob: "1982-02-27", city: "Kolkata", state: "West Bengal", employment_type: "Business Owner", business_name: "Das Agro Industries", business_type: "Manufacturing", business_vintage: 13, annual_turnover: 96000000, monthly_income: 720000, loan_type: "Business Loan", loan_amount: 5000000, tenure: 60, stage: "payout", gender: "Male" },
    { name: "Anita Kulkarni", mobile: "9822001111", pan: "BMJPA1234K", dob: "1996-10-11", city: "Nagpur", state: "Maharashtra", employment_type: "Salaried", employer: "Mahindra & Mahindra", monthly_income: 68000, loan_type: "Personal Loan", loan_amount: 300000, tenure: 18, stage: "payout", gender: "Female" },
    { name: "Kunal Desai", mobile: "9822001112", pan: "BMJPD2345L", dob: "1987-05-19", city: "Surat", state: "Gujarat", employment_type: "Self-employed", business_name: "Desai Diamonds", business_type: "Trading", business_vintage: 8, annual_turnover: 64000000, monthly_income: 520000, loan_type: "Loan Against Property", loan_amount: 2000000, tenure: 96, stage: "uw", gender: "Male" }
  ];
  let coCount = 0, coDisbursed = 0;
  for (const s of stories) {
    const ref = await applicantRef(t);
    const id = (await run(
      `INSERT INTO gn_applicants (tenant_id, ref, name, mobile, email, pan, dob, gender, city, state, applicant_type,
         employment_type, employer, business_name, business_type, business_vintage, industry, monthly_income, annual_turnover,
         loan_type, loan_amount, tenure, purpose, bank_name, bank_account, source, is_demo, otp_status, consent_status, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Individual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HDFC Bank', ?, 'demo', 1, 'verified', 'received', ?)`,
      [t, ref, s.name, s.mobile, `${s.name.toLowerCase().replace(/\s+/g, ".")}@example.in`, s.pan, s.dob, s.gender ?? null, s.city, s.state,
        s.employment_type, s.employer ?? null, s.business_name ?? null, s.business_type ?? null, s.business_vintage ?? null,
        s.industry ?? null, s.monthly_income ?? null, s.annual_turnover ?? null, s.loan_type, s.loan_amount, s.tenure,
        s.loan_type === "Home Loan" || s.loan_type === "Loan Against Property" ? "Asset purchase" : "Business / personal requirement",
        String(501001000000 + s.loan_amount % 9000000), uid]
    )).lastId;
    const a = await q1<Record<string, any>>("SELECT * FROM gn_applicants WHERE id = ?", [id])!;
    coCount++;
    if (s.stage === "consent") {
      await aplEventSeed(t, id, "CONSENT REQUIRED", "Consent request ready to send");
      continue;
    }
    if (s.stage === "kyc") {
      await grantConsent(t, id, "Loan application, KYC, credit information & lender sharing", uid);
      await runKyc(t, id, uid);
      continue;
    }
    await grantConsent(t, id, "Loan application, KYC, credit information & lender sharing", uid);
    await runKyc(t, id, uid);
    await runCredit(t, id, uid);
    const matches = await matchApplicant(t, a);
    const matchIds = matches.length ? await storeMatches(t, id, matches) : [];
    if (!matchIds.length) { await aplEventSeed(t, id, "NO MATCH", "No eligible lender product"); continue; }
    const bestIdx = matches.findIndex((m) => m.status === "eligible");
    const appId = await createApplication(t, a, { match_id: matchIds[bestIdx >= 0 ? bestIdx : 0] }, uid);
    await run("UPDATE gn_documents SET status = 'verified', verified_at = datetime('now') WHERE tenant_id = ? AND entity_type = 'application' AND entity_id = ?", [t, appId]);
    if (s.stage === "app") { await aplEventSeed(t, id, "APPLICATION CREATED", "Ready for submission"); continue; }
    if (s.stage === "docs") { await run("UPDATE gn_applicants SET doc_status = 'completed', app_status = 'created' WHERE id = ?", [id]); continue; }
    await submitApplication(t, appId, uid);
    if (s.stage === "submitted") { await aplEventSeed(t, id, "SUBMITTED", "Awaiting lender underwriting"); continue; }
    if (s.stage === "rejected") {
      await simulateLender(t, appId, "underwrite", uid);
      await simulateLender(t, appId, "reject", uid);
      continue;
    }
    await simulateLender(t, appId, "underwrite", uid);
    if (s.stage === "uw") { await aplEventSeed(t, id, "UNDERWRITING", "Lender underwriting in progress"); continue; }
    await simulateLender(t, appId, "approve", uid, { amount: s.loan_amount });
    if (s.stage === "approved") { await aplEventSeed(t, id, "APPROVED", "Sanction approved by lender"); continue; }
    await simulateLender(t, appId, "agreement", uid);
    if (s.stage === "agreement") { await aplEventSeed(t, id, "AGREEMENT COMPLETED", "Agreement & eSign complete"); continue; }
    await simulateLender(t, appId, "disburse", uid, { amount: s.loan_amount });
    await simulateLender(t, appId, "fund", uid, { amount: s.loan_amount });
    await simulateLender(t, appId, "confirm", uid);
    coDisbursed += s.loan_amount;
    if (s.stage === "disb") { await aplEventSeed(t, id, "DISBURSED", `₹${s.loan_amount.toLocaleString("en-IN")} disbursed`); continue; }
    await simulateLender(t, appId, "payout", uid);
    coDisbursed += 0;
  }

  /* 500-row demo bulk batch — processed end-to-end (validated → deduped → pipeline) */
  const bid = (await run(
    `INSERT INTO gn_bulk_batches (tenant_id, name, description, source, loan_type, assigned_team, priority, mode, status, is_demo, created_by)
     VALUES (?, '500 Applicant Demo Batch', 'Generated relational demo batch — 300 PL · 100 BL · 50 HL · 25 LAP · 15 Vehicle · 10 Equipment (DEMO / SANDBOX)', 'Demo', 'Mixed', 'Demo Processing Team', 'high', 'assisted', 'uploaded', 1, ?)`,
    [t, uid]
  )).lastId;
  const rows = generateDemoRows(bid);
  for (const r of rows) {
    await run("INSERT INTO gn_bulk_rows (tenant_id, batch_id, row_no, raw, mapped, status) VALUES (?, ?, ?, ?, ?, 'pending')", [t, bid, r.row_no, JSON.stringify(r), JSON.stringify(r)]);
  }
  await run("UPDATE gn_bulk_batches SET total_rows = ? WHERE id = ?", [rows.length, bid]);
  for (const row of await q<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE batch_id = ?", [bid])) {
    const mapped = JSON.parse(row.mapped);
    const { errors, missing } = validateRow(mapped);
    await run("UPDATE gn_bulk_rows SET validation = ?, status = ?, error = ? WHERE id = ?",
      [JSON.stringify(errors), errors.length === 0 ? "valid" : missing ? "missing" : "invalid", errors.length ? errors.map((e) => e.error).join("; ") : null, row.id]);
    if (errors.length) {
      await run("INSERT INTO gn_bulk_errors (tenant_id, batch_id, row_id, category, message, recommendation) VALUES (?, ?, ?, 'invalid_data', ?, ?)",
        [t, bid, row.id, `Row ${row.row_no}: ${errors.map((e) => e.error).join("; ")}`, "Correct the highlighted fields in the batch detail page"]);
    }
  }
  const seenM = new Map<string, number>();
  const seenP = new Map<string, number>();
  let dupN = 0;
  for (const row of await q<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE batch_id = ? AND status = 'valid' ORDER BY row_no", [bid])) {
    const mapped = JSON.parse(row.mapped);
    const mobile = normMobile(mapped.mobile);
    const pan = mapped.pan ? String(mapped.pan).toUpperCase() : null;
    const inBatch = mobile && seenM.has(mobile) ? `Row ${seenM.get(mobile)} has the same mobile ${mobile}` : pan && seenP.has(pan) ? `Row ${seenP.get(pan)} has the same PAN ${pan}` : null;
    if (inBatch) {
      dupN++;
      await run("UPDATE gn_bulk_rows SET status = 'duplicate', error = ? WHERE id = ?", [inBatch, row.id]);
      await run("INSERT INTO gn_bulk_errors (tenant_id, batch_id, row_id, category, message, recommendation) VALUES (?, ?, ?, 'duplicate', ?, ?)",
        [t, bid, row.id, `Row ${row.row_no}: ${inBatch}`, "Create a new application for this existing customer instead"]);
      continue;
    }
    if (mobile) seenM.set(mobile, row.row_no);
    if (pan) seenP.set(pan, row.row_no);
  }
  const counts = await q1<Record<string, any>>(
    `SELECT SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END) AS valid, SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) AS invalid,
       SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) AS missing, SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END) AS duplicates
     FROM gn_bulk_rows WHERE batch_id = ?`, [bid])!;
  await run("UPDATE gn_bulk_batches SET status = 'validated', valid = ?, invalid = ?, missing = ?, duplicates = ? WHERE id = ?",
    [counts.valid ?? 0, counts.invalid ?? 0, counts.missing ?? 0, dupN, bid]);
  const bulk = await processBulkBatch(t, bid, uid);
  console.log(`[GN CO SEED] applicants=${coCount} disbursed=${inr(coDisbursed)} bulk_batch=${bid} rows=${rows.length} valid=${counts.valid} dup=${dupN} invalid=${counts.invalid} processed=${bulk.created} disbursed=${bulk.disbursed} amt=${inr((await q1<Record<string, any>>("SELECT disbursed_amount FROM gn_bulk_batches WHERE id = ?", [bid]) ?? { disbursed_amount: 0 }).disbursed_amount ?? 0)}`);
}

async function aplEventSeed(tenantId: number, applicantId: number, event: string, note: string) {
  await run("INSERT INTO gn_applicant_events (tenant_id, applicant_id, event, note, actor) VALUES (?, ?, ?, ?, NULL)", [tenantId, applicantId, event, note]);
}
