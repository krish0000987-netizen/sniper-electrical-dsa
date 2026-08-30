import { Router } from "express";
import { z } from "zod";
import { q, q1, run } from "../db/connection.js";
import { audit } from "../core/audit.js";
import { asyncH, authRequired, clientIp, requirePerm, type AuthedRequest } from "../middleware.js";
import { bulkError, job, mulberry32, normMobile, processBulkBatch, safeJson } from "../core/gn-co.js";

export const gnBulkRouter = Router();
gnBulkRouter.use(authRequired);

const T = (req: AuthedRequest) => req.user!.tenant_id;

/* ================= File parsing ================= */

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let cur = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = ""; rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function parseCsv(text: string): string[][] { return parseDelimited(text.replace(/^\uFEFF/, ""), ","); }
function parseTsv(text: string): string[][] { return parseDelimited(text, "\t"); }

function parseJson(text: string): Record<string, any>[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : data.rows ?? data.data;
  if (!Array.isArray(arr)) throw new Error("JSON must be an array of objects");
  return arr;
}

function parseXlsx(buf: Buffer): Record<string, any>[] {
  const XLSX = require("xlsx") as any;
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

/* ================= Column mapping ================= */

const COL_ALIASES: Record<string, string[]> = {
  name: ["name", "full name", "applicant name", "customer name", "borrower name", "applicant", "applicant's name", "first name last name"],
  mobile: ["mobile", "mobile number", "mobile no", "phone", "phone number", "contact", "contact number", "contact no", "mob no", "telephone"],
  email: ["email", "email id", "email address", "e-mail", "email id"],
  pan: ["pan", "pan number", "pan no", "pan card", "pan card number"],
  dob: ["dob", "date of birth", "birth date", "birthday"],
  gender: ["gender", "sex"],
  city: ["city", "town", "district"],
  state: ["state"],
  pincode: ["pincode", "pin code", "pin", "zip", "zip code", "postal code"],
  applicant_type: ["applicant type", "customer type", "borrower type", "type"],
  employment_type: ["employment type", "employment", "occupation", "profile", "customer profile"],
  company: ["company", "employer", "organization", "organisation", "employer name"],
  business_name: ["business name", "firm name", "company name", "entity name"],
  business_type: ["business type", "business category", "firm type", "entity type"],
  business_vintage: ["business vintage", "vintage", "business age", "years in business", "firm vintage", "years of business"],
  industry: ["industry", "sector", "business sector"],
  monthly_income: ["monthly income", "salary", "monthly salary", "income", "net income", "monthly income inr", "monthly income rs", "monthly salary inr"],
  annual_income: ["annual income", "annual salary", "yearly income", "gross annual income"],
  annual_turnover: ["annual turnover", "turnover", "gross turnover", "turnover inr", "turnover rs", "gst turnover", "sales", "annual sales", "revenue"],
  gst: ["gst", "gstin", "gst number", "gst registration"],
  udyam: ["udyam", "udyam number", "udyam registration", "udyam certificate"],
  existing_emi: ["existing emi", "emi", "monthly emi", "current emi", "existing monthly obligation"],
  loan_type: ["loan type", "loan category", "product type", "product", "loan product"],
  loan_amount: ["loan amount", "amount", "loan required", "required amount", "loan amount inr", "loan amount rs", "requested amount", "finance amount"],
  tenure: ["tenure", "loan tenure", "tenure months", "months", "tenure in months"],
  purpose: ["purpose", "loan purpose", "end use"],
  source: ["source", "lead source", "channel", "origin"],
  builder: ["builder", "developer", "builder name"],
  oem: ["oem", "manufacturer", "oem name"],
  dsa: ["dsa", "dsa code", "partner", "partner code", "agent", "dsa name", "channel partner"],
  property_type: ["property type", "property", "asset type"],
  property_value: ["property value", "property price", "property cost"],
  asset_value: ["asset value", "vehicle value", "equipment value", "asset price", "invoice value"],
  down_payment: ["down payment", "downpayment", "margin"]
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function autoMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (field in map) continue;
      if (aliases.some((al) => norm(al) === n) || aliases.some((al) => n.includes(norm(al)) && norm(al).length > 3)) {
        map[field] = i;
        break;
      }
    }
  });
  return map;
}

export function mapRow(headers: string[], values: string[], mapping: Record<string, number>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [field, idx] of Object.entries(mapping)) {
    const v = (values[idx] ?? "").toString().trim();
    if (v !== "") out[field] = v;
  }
  return out;
}

/* ================= Validation ================= */

export function validateRow(mapped: Record<string, any>): { errors: { field: string; error: string }[]; missing: boolean } {
  const errors: { field: string; error: string }[] = [];
  let missing = false;
  if (!mapped.name) { errors.push({ field: "name", error: "Missing applicant name" }); missing = true; }
  const mobile = normMobile(mapped.mobile);
  if (!mobile) { errors.push({ field: "mobile", error: "Missing mobile number" }); missing = true; }
  else if (!/^[6-9]\d{9}$/.test(mobile)) errors.push({ field: "mobile", error: `Invalid mobile format (${mobile})` });
  if (mapped.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(mapped.pan).toUpperCase())) errors.push({ field: "pan", error: "Invalid PAN format (expected ABCDE1234F)" });
  if (mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(mapped.email))) errors.push({ field: "email", error: "Invalid email address" });
  if (mapped.dob) {
    const d = new Date(String(mapped.dob));
    if (isNaN(d.getTime())) errors.push({ field: "dob", error: "Invalid DOB" });
    else {
      const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
      if (age < 18 || age > 75) errors.push({ field: "dob", error: `Age ${age} outside 18–75` });
    }
  }
  if (mapped.pincode && !/^\d{6}$/.test(String(mapped.pincode))) errors.push({ field: "pincode", error: "Invalid pincode (6 digits)" });
  const amt = Number(mapped.loan_amount);
  if (!mapped.loan_amount) { errors.push({ field: "loan_amount", error: "Missing loan amount" }); missing = true; }
  else if (!Number.isFinite(amt) || amt <= 0) errors.push({ field: "loan_amount", error: "Invalid loan amount" });
  else if (amt > 10000000000) errors.push({ field: "loan_amount", error: "Loan amount exceeds ₹1,000 Cr" });
  if (mapped.tenure && (Number(mapped.tenure) < 1 || Number(mapped.tenure) > 360)) errors.push({ field: "tenure", error: "Tenure outside 1–360 months" });
  if (mapped.monthly_income && Number(mapped.monthly_income) <= 0) errors.push({ field: "monthly_income", error: "Invalid monthly income" });
  if (mapped.annual_turnover && Number(mapped.annual_turnover) <= 0) errors.push({ field: "annual_turnover", error: "Invalid annual turnover" });
  return { errors, missing };
}

async function existingCustomer(t: number, mapped: Record<string, any>) {
  const mobile = normMobile(mapped.mobile);
  const pan = mapped.pan ? String(mapped.pan).toUpperCase() : null;
  const email = mapped.email ? String(mapped.email).toLowerCase() : null;
  const c = mobile ? await q1<Record<string, any>>("SELECT id, name, mobile, pan FROM customers WHERE tenant_id = ? AND mobile = ?", [t, mobile]) : null;
  if (c) return { type: "existing_customer", detail: `Customer ${c.name} (mobile ${mobile})` };
  const c2 = pan ? await q1<Record<string, any>>("SELECT id, name, pan FROM customers WHERE tenant_id = ? AND pan = ?", [t, pan]) : null;
  if (c2) return { type: "existing_customer", detail: `Customer ${c2.name} (PAN ${pan})` };
  const a = mobile ? await q1<Record<string, any>>("SELECT id, ref, name FROM gn_applicants WHERE tenant_id = ? AND mobile = ?", [t, mobile]) : null;
  if (a) return { type: "existing_applicant", detail: `Applicant ${a.name} (${a.ref})` };
  const a2 = pan ? await q1<Record<string, any>>("SELECT id, ref, name FROM gn_applicants WHERE tenant_id = ? AND pan = ?", [t, pan]) : null;
  if (a2) return { type: "existing_applicant", detail: `Applicant ${a2.name} (${a2.ref})` };
  const e = email ? await q1<Record<string, any>>("SELECT id, name FROM customers WHERE tenant_id = ? AND email = ?", [t, email]) : null;
  if (e) return { type: "existing_customer", detail: `Customer ${e.name} (email ${email})` };
  return null;
}

/* ================= Demo data generator ================= */

const FIRST = ["Rahul", "Priya", "Amit", "Sneha", "Vikram", "Pooja", "Rohit", "Kavita", "Arjun", "Neha", "Sanjay", "Anita", "Kunal", "Divya", "Nikhil", "Meera", "Suresh", "Ritu", "Aditya", "Shreya", "Manoj", "Pallavi", "Deepak", "Ishita", "Rajesh", "Kiran", "Aakash", "Swati", "Varun", "Nikita", "Gaurav", "Pratibha", "Harish", "Lakshmi", "Imran", "Sakshi", "Naveen", "Jyoti", "Rakesh", "Anjali"];
const LAST = ["Sharma", "Patel", "Singh", "Reddy", "Gupta", "Iyer", "Nair", "Mehta", "Verma", "Joshi", "Das", "Kulkarni", "Bose", "Mishra", "Agarwal", "Chauhan", "Deshmukh", "Rao", "Menon", "Kapoor", "Bhat", "Pillai", "Trivedi", "Shah", "Malhotra", "Saxena", "Tiwari", "Ghosh", "Khan", "Chopra", "Yadav", "Kaur", "Banerjee", "Shetty", "Naidu", "Prasad", "Choudhary", "Dutta", "Saini", "Biswas"];
const CITIES = ["Ahmedabad", "Surat", "Mumbai", "Pune", "Bengaluru", "Hyderabad", "Chennai", "Delhi", "Kolkata", "Jaipur", "Lucknow", "Indore", "Nagpur", "Vadodara", "Bhopal", "Coimbatore", "Kochi", "Chandigarh"];
const STATES = ["Gujarat", "Gujarat", "Maharashtra", "Maharashtra", "Karnataka", "Telangana", "Tamil Nadu", "Delhi", "West Bengal", "Rajasthan", "Uttar Pradesh", "Madhya Pradesh", "Maharashtra", "Gujarat", "Madhya Pradesh", "Tamil Nadu", "Kerala", "Chandigarh"];
const BIZ = ["Trading", "Manufacturing", "Retail", "Services", "Logistics", "Construction", "Healthcare", "IT Services", "Food & Beverage", "Textiles"];

function genMobile(rng: () => number): string {
  return `9${Math.floor(1 + rng() * 8)}${String(Math.floor(rng() * 1e8)).padStart(8, "0")}`;
}
function genPan(rng: () => number, i: number): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let k = 0; k < 5; k++) s += letters[Math.floor(rng() * letters.length)];
  return `${s}${String(1000 + i).slice(-4)}${letters[Math.floor(rng() * letters.length)]}`;
}
function genDob(rng: () => number): string {
  const y = 1972 + Math.floor(rng() * 30);
  const m = 1 + Math.floor(rng() * 12);
  const d = 1 + Math.floor(rng() * 28);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const LOAN_PLAN: [string, number][] = [
  ["Personal Loan", 300], ["Business Loan", 100], ["Home Loan", 50],
  ["Loan Against Property", 25], ["Vehicle Loan", 15], ["Equipment Loan", 10]
];

export function generateDemoRows(seed: number): Record<string, any>[] {
  const rng = mulberry32(seed);
  const rows: Record<string, any>[] = [];
  let i = 1;
  const lastMobiles: string[] = [];
  for (const [loanType, count] of LOAN_PLAN) {
    for (let k = 0; k < count; k++) {
      const isDup = i % 27 === 0;      // ~18 duplicates
      const isInvalid = i % 25 === 0;  // 20 invalid
      const isMissing = i % 40 === 0;  // a few missing required data
      const name = `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`;
      let mobile = genMobile(rng);
      if (isDup && lastMobiles.length) mobile = lastMobiles[Math.floor(rng() * lastMobiles.length)];
      lastMobiles.push(mobile);
      const business = loanType === "Personal Loan" ? null : {
        name: `${FIRST[Math.floor(rng() * FIRST.length)]} ${BIZ[Math.floor(rng() * BIZ.length)]}`,
        vintage: 1 + Math.floor(rng() * 12),
        turnover: Math.round((10 + rng() * 190) * 100000)
      };
      const amountMap: Record<string, number> = {
        "Personal Loan": 50000 + Math.floor(rng() * 20) * 25000,
        "Business Loan": 200000 + Math.floor(rng() * 40) * 100000,
        "Home Loan": 1000000 + Math.floor(rng() * 25) * 100000,
        "Loan Against Property": 1500000 + Math.floor(rng() * 20) * 250000,
        "Vehicle Loan": 200000 + Math.floor(rng() * 15) * 50000,
        "Equipment Loan": 300000 + Math.floor(rng() * 12) * 100000
      };
      const row: Record<string, any> = {
        row_no: i,
        name: isInvalid ? name.slice(0, 2) + "??" : name,
        mobile: isInvalid ? (i % 50 === 0 ? "999" : "12345") : mobile,
        email: `${String(i)}.${name.toLowerCase().replace(/\s+/g, ".")}@example.in`,
        pan: isInvalid && i % 3 === 0 ? "INVALID" : genPan(rng, i),
        dob: genDob(rng),
        gender: i % 2 ? "Male" : "Female",
        city: CITIES[i % CITIES.length],
        state: STATES[i % STATES.length],
        pincode: String(380000 + Math.floor(rng() * 600000)),
        applicant_type: "Individual",
        employment_type: loanType === "Personal Loan" ? (i % 3 ? "Salaried" : "Self-employed") : "Self-employed",
        company: loanType === "Personal Loan" ? `${BIZ[i % BIZ.length]} Pvt Ltd` : null,
        business_name: business?.name ?? null,
        business_type: business ? BIZ[i % BIZ.length] : null,
        business_vintage: business?.vintage ?? null,
        monthly_income: loanType === "Personal Loan" ? 25000 + Math.floor(rng() * 12) * 5000 : 40000 + Math.floor(rng() * 20) * 10000,
        annual_turnover: business?.turnover ?? null,
        gst: business ? `27ABCDE${String(1000 + i).slice(-4)}F1Z5` : null,
        existing_emi: i % 4 === 0 ? 5000 + Math.floor(rng() * 15) * 1000 : 0,
        loan_type: loanType,
        loan_amount: isMissing ? null : amountMap[loanType],
        tenure: loanType === "Home Loan" || loanType === "Loan Against Property" ? 120 + Math.floor(rng() * 12) * 12 : 12 + Math.floor(rng() * 4) * 12,
        purpose: loanType === "Personal Loan" ? "Personal needs" : loanType === "Home Loan" ? "Purchase of residential property" : "Business expansion",
        source: "Demo Batch"
      };
      rows.push(row);
      i++;
    }
  }
  return rows;
}

/* ================= Batch CRUD ================= */

const batchSchema = z.object({
  name: z.string().min(2), description: z.string().optional(), source: z.string().optional(),
  loan_type: z.string().optional(), assigned_team: z.string().optional(), priority: z.string().optional(), mode: z.string().optional()
});

gnBulkRouter.get("/gn/bulk", requirePerm("gn.bulk.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const batches = await q<Record<string, any>>(
    `SELECT b.*, u.name AS created_name,
       (SELECT COUNT(*) FROM gn_bulk_rows r WHERE r.batch_id = b.id) AS rows,
       (SELECT COUNT(*) FROM gn_bulk_errors e WHERE e.batch_id = b.id AND e.status = 'open') AS open_errors
     FROM gn_bulk_batches b LEFT JOIN users u ON u.id = b.created_by
     WHERE b.tenant_id = ? ORDER BY b.id DESC LIMIT 100`, [t]);
  const kpi = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS total_batches,
       SUM(CASE WHEN status IN ('processing','validating','uploaded') THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(total_rows) AS total_rows,
       SUM(valid) AS valid,
       SUM(duplicates) AS duplicates,
       SUM(invalid) AS invalid,
       SUM(applicants_created) AS applicants_created,
       SUM(applications_created) AS applications_created,
       SUM(submitted) AS submitted,
       SUM(approved) AS approved,
       SUM(disbursed) AS disbursed,
       COALESCE(SUM(disbursed_amount), 0) AS disbursed_amount,
       COALESCE(SUM(expected_payout), 0) AS expected_payout
     FROM gn_bulk_batches WHERE tenant_id = ?`, [t])!;
  res.json({ batches, kpi });
}));

gnBulkRouter.post("/gn/bulk/batches", requirePerm("gn.bulk.create"), asyncH(async (req: AuthedRequest, res) => {
  const b = batchSchema.parse(req.body);
  const t = T(req);
  const id = (await run(
    `INSERT INTO gn_bulk_batches (tenant_id, name, description, source, loan_type, assigned_team, priority, mode, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [t, b.name, b.description ?? null, b.source ?? "Manual", b.loan_type ?? null, b.assigned_team ?? null, b.priority ?? "normal", b.mode ?? "assisted", req.user!.id]
  )).lastId;
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.batch.create", entityType: "gn_bulk_batch", entityId: id, after: b, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_bulk_batches WHERE id = ?", [id]));
}));

gnBulkRouter.get("/gn/bulk/batches/:id", requirePerm("gn.bulk.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const batch = await q1<Record<string, any>>(
    `SELECT b.*, u.name AS created_name FROM gn_bulk_batches b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ? AND b.tenant_id = ?`,
    [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  const { page = 1, limit = 25, status = "", q: query = "" } = req.query as Record<string, string>;
  const where = ["r.batch_id = ?"];
  const params: unknown[] = [batch.id];
  if (status) { where.push("r.status = ?"); params.push(status); }
  if (query) { where.push("(r.mapped LIKE ? OR r.error LIKE ?)"); params.push(`%${query}%`, `%${query}%`); }
  const total = (await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM gn_bulk_rows r WHERE ${where.join(" AND ")}`, params))!.n;
  const off = (Math.max(1, Number(page)) - 1) * Number(limit);
  const rows = await q<Record<string, any>>(`SELECT * FROM gn_bulk_rows r WHERE ${where.join(" AND ")} ORDER BY r.row_no LIMIT ? OFFSET ?`, [...params, Number(limit), off]);
  const byStatus = await q<Record<string, any>>("SELECT status, COUNT(*) AS n FROM gn_bulk_rows WHERE batch_id = ? GROUP BY status", [batch.id]);
  const errors = await q<Record<string, any>>(
    `SELECT e.*, r.row_no FROM gn_bulk_errors e LEFT JOIN gn_bulk_rows r ON r.id = e.row_id
     WHERE e.batch_id = ? ORDER BY e.id DESC LIMIT 100`, [batch.id]);
  const jobs = await q1<Record<string, any>>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'retrying' THEN 1 ELSE 0 END) AS retrying,
       SUM(CASE WHEN status IN ('queued','processing','paused') THEN 1 ELSE 0 END) AS pending
     FROM gn_bulk_jobs WHERE batch_id = ?`, [batch.id])!;
  const jobRows = await q<Record<string, any>>(
    `SELECT j.*, r.row_no FROM gn_bulk_jobs j LEFT JOIN gn_bulk_rows r ON r.id = j.row_id
     WHERE j.batch_id = ? ORDER BY j.id DESC LIMIT 60`, [batch.id]);
  res.json({ batch, rows, total, page: Number(page), limit: Number(limit), byStatus, errors, jobs, jobRows });
}));

gnBulkRouter.post("/gn/bulk/batches/:id/upload", requirePerm("gn.bulk.upload"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  const b = z.object({ filename: z.string(), data: z.string(), mapping: z.record(z.string(), z.number()).optional() }).parse(req.body);
  const buf = Buffer.from(b.data, "base64");
  if (buf.length > 10 * 1024 * 1024) { res.status(400).json({ error: "File exceeds 10 MB limit" }); return; }
  const fname = b.filename.toLowerCase();
  let records: { header: string[]; values: string[]; mapped: Record<string, any>; _map: Record<string, number> }[] = [];
  let usedMap: Record<string, number> = {};
  try {
    if (fname.endsWith(".csv")) {
      const grid = parseCsv(buf.toString("utf8"));
      const header = grid[0]; usedMap = b.mapping ?? autoMap(header);
      records = grid.slice(1).map((vals) => ({ header, values: vals, mapped: mapRow(header, vals, usedMap), _map: usedMap }));
    } else if (fname.endsWith(".tsv") || fname.endsWith(".txt")) {
      const grid = parseTsv(buf.toString("utf8"));
      const header = grid[0]; usedMap = b.mapping ?? autoMap(header);
      records = grid.slice(1).map((vals) => ({ header, values: vals, mapped: mapRow(header, vals, usedMap), _map: usedMap }));
    } else if (fname.endsWith(".json")) {
      const arr = parseJson(buf.toString("utf8"));
      const header = Object.keys(arr[0] ?? {});
      usedMap = b.mapping ?? autoMap(header);
      records = arr.map((o) => ({ header, values: header.map((h) => String(o[h] ?? "")), mapped: mapRow(header, header.map((h) => String(o[h] ?? "")), usedMap), _map: usedMap }));
    } else if (fname.endsWith(".xlsx") || fname.endsWith(".xls")) {
      const arr = parseXlsx(buf);
      const header = Object.keys(arr[0] ?? {});
      usedMap = b.mapping ?? autoMap(header);
      records = arr.map((o) => ({ header, values: header.map((h) => String(o[h] ?? "")), mapped: mapRow(header, header.map((h) => String(o[h] ?? "")), usedMap), _map: usedMap }));
    } else {
      res.status(400).json({ error: "Unsupported file type — use CSV, TSV, JSON or Excel" });
      return;
    }
  } catch (e: any) {
    res.status(400).json({ error: `Could not parse file: ${e?.message ?? e}` });
    return;
  }
  if (records.length > 10000) { res.status(400).json({ error: "Maximum 10,000 rows per batch" }); return; }
  await run("DELETE FROM gn_bulk_rows WHERE batch_id = ?", [batch.id]);
  let n = 0;
  for (const rec of records) {
    await run(
      "INSERT INTO gn_bulk_rows (tenant_id, batch_id, row_no, raw, mapped, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [t, batch.id, n + 1, JSON.stringify({ header: rec.header, values: rec.values }), JSON.stringify(rec.mapped)]
    );
    n++;
  }
  await run("UPDATE gn_bulk_batches SET status = 'uploaded', total_rows = ?, valid = 0, invalid = 0, duplicates = 0, updated_at = datetime('now') WHERE id = ?", [n, batch.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.upload", entityType: "gn_bulk_batch", entityId: batch.id, after: { filename: b.filename, rows: n }, ip: clientIp(req) });
  res.json({ ok: true, rows: n, mapping: usedMap, header: records[0]?.header ?? [] });
}));

gnBulkRouter.post("/gn/bulk/batches/:id/map", requirePerm("gn.bulk.process"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ mapping: z.record(z.string(), z.number()) }).parse(req.body);
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  const rows = await q<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE batch_id = ?", [batch.id]);
  let mapped = 0;
  for (const row of rows) {
    const raw = safeJson(row.raw, null);
    let next: Record<string, any>;
    if (raw && Array.isArray(raw.values) && Array.isArray(raw.header)) {
      next = mapRow(raw.header, raw.values, b.mapping);
    } else {
      next = safeJson(row.mapped, {});
    }
    await run("UPDATE gn_bulk_rows SET mapped = ?, status = 'pending', error = NULL WHERE id = ?", [JSON.stringify(next), row.id]);
    mapped++;
  }
  await run("UPDATE gn_bulk_batches SET status = 'uploaded', valid = 0, invalid = 0, duplicates = 0, updated_at = datetime('now') WHERE id = ?", [batch.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.map", entityType: "gn_bulk_batch", entityId: batch.id, after: { mapping: b.mapping }, ip: clientIp(req) });
  res.json({ ok: true, rows: mapped });
}));

gnBulkRouter.post("/gn/bulk/batches/:id/validate", requirePerm("gn.bulk.process"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  await run("UPDATE gn_bulk_batches SET status = 'validating', updated_at = datetime('now') WHERE id = ?", [batch.id]);
  const rows = await q<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE batch_id = ?", [batch.id]);
  let valid = 0, invalid = 0, missing = 0;
  for (const row of rows) {
    const mapped = safeJson(row.mapped, {});
    const { errors, missing: isMissing } = validateRow(mapped);
    await run("UPDATE gn_bulk_rows SET validation = ?, status = ?, error = ? WHERE id = ?",
      [JSON.stringify(errors), errors.length === 0 ? "valid" : isMissing ? "missing" : "invalid", errors.length ? errors.map((e) => e.error).join("; ") : null, row.id]);
    if (errors.length === 0) valid++;
    else if (isMissing) missing++;
    else invalid++;
    for (const e of errors) {
      await bulkError(t, batch.id, row.id, "invalid_data", `Row ${row.row_no}: ${e.field} — ${e.error}`, `Correct the ${e.field} value in row ${row.row_no} and revalidate`);
    }
  }
  await run("UPDATE gn_bulk_batches SET status = 'validated', valid = ?, invalid = ?, missing = ?, updated_at = datetime('now') WHERE id = ?", [valid, invalid, missing, batch.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.validate", entityType: "gn_bulk_batch", entityId: batch.id, after: { valid, invalid, missing }, ip: clientIp(req) });
  res.json({ valid, invalid, missing });
}));

gnBulkRouter.post("/gn/bulk/batches/:id/dedupe", requirePerm("gn.bulk.process"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  const rows = await q<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE batch_id = ? AND status = 'valid' ORDER BY row_no", [batch.id]);
  const seenMobiles = new Map<string, number>();
  const seenPans = new Map<string, number>();
  let duplicates = 0;
  for (const row of rows) {
    const mapped = safeJson(row.mapped, {});
    const mobile = normMobile(mapped.mobile);
    const pan = mapped.pan ? String(mapped.pan).toUpperCase() : null;
    const inBatch = mobile && seenMobiles.has(mobile) ? { detail: `Row ${seenMobiles.get(mobile)} has the same mobile ${mobile}` } : pan && seenPans.has(pan) ? { detail: `Row ${seenPans.get(pan)} has the same PAN ${pan}` } : null;
    const ext = !inBatch ? await existingCustomer(t, mapped) : null;
    const dup = inBatch ?? ext;
    if (dup) {
      duplicates++;
      await run("UPDATE gn_bulk_rows SET status = 'duplicate', error = ? WHERE id = ?", [dup.detail, row.id]);
      await bulkError(t, batch.id, row.id, "duplicate", `Row ${row.row_no}: ${dup.detail}`, "Create a new application for this existing customer instead of a new customer");
      continue;
    }
    if (mobile) seenMobiles.set(mobile, row.row_no);
    if (pan) seenPans.set(pan, row.row_no);
  }
  await run("UPDATE gn_bulk_batches SET duplicates = ?, valid = (SELECT COUNT(*) FROM gn_bulk_rows WHERE batch_id = ? AND status = 'valid'), updated_at = datetime('now') WHERE id = ?", [duplicates, batch.id, batch.id]);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.dedupe", entityType: "gn_bulk_batch", entityId: batch.id, after: { duplicates }, ip: clientIp(req) });
  res.json({ duplicates });
}));

gnBulkRouter.post("/gn/bulk/batches/:id/preview", requirePerm("gn.bulk.process"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  const byStatus = await q<Record<string, any>>("SELECT status, COUNT(*) AS n FROM gn_bulk_rows WHERE batch_id = ? GROUP BY status", [batch.id]);
  const byLoanType = await q<Record<string, any>>(
    `SELECT json_extract(mapped, '$.loan_type') AS loan_type, COUNT(*) AS n FROM gn_bulk_rows
     WHERE batch_id = ? AND status = 'valid' GROUP BY loan_type ORDER BY n DESC`, [batch.id]);
  res.json({ batch, byStatus, byLoanType, preview: true });
}));

gnBulkRouter.post("/gn/bulk/batches/:id/process", requirePerm("gn.bulk.process"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  if (batch.valid === 0) { res.status(400).json({ error: "No valid rows — run validation and dedupe first" }); return; }
  const out = await processBulkBatch(t, batch.id, req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.process", entityType: "gn_bulk_batch", entityId: batch.id, after: out, ip: clientIp(req) });
  res.json(out);
}));

gnBulkRouter.post("/gn/bulk/batches/:id/control", requirePerm("gn.bulk.manage"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ action: z.enum(["pause", "resume", "cancel", "retry", "restart_failed", "archive"]) }).parse(req.body);
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  if (b.action === "pause") {
    await run("UPDATE gn_bulk_batches SET status = 'paused', updated_at = datetime('now') WHERE id = ?", [batch.id]);
    await run("UPDATE gn_bulk_jobs SET status = 'paused' WHERE batch_id = ? AND status IN ('queued','processing')", [batch.id]);
  } else if (b.action === "resume") {
    await run("UPDATE gn_bulk_batches SET status = 'validated', updated_at = datetime('now') WHERE id = ?", [batch.id]);
  } else if (b.action === "cancel") {
    await run("UPDATE gn_bulk_batches SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", [batch.id]);
    await run("UPDATE gn_bulk_jobs SET status = 'cancelled' WHERE batch_id = ? AND status IN ('queued','processing','paused')", [batch.id]);
  } else if (b.action === "retry" || b.action === "restart_failed") {
    await run("UPDATE gn_bulk_rows SET status = 'valid' WHERE batch_id = ? AND status = 'failed'", [batch.id]);
    await run("UPDATE gn_bulk_errors SET status = 'resolved' WHERE batch_id = ? AND status = 'open' AND category != 'duplicate'", [batch.id]);
    const out = await processBulkBatch(t, batch.id, req.user!.id);
    await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.retry", entityType: "gn_bulk_batch", entityId: batch.id, after: out, ip: clientIp(req) });
    res.json(out);
    return;
  } else if (b.action === "archive") {
    await run("UPDATE gn_bulk_batches SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", [batch.id]);
  }
  await audit({ tenantId: t, userId: req.user!.id, action: `gn.bulk.${b.action}`, entityType: "gn_bulk_batch", entityId: batch.id, before: { status: batch.status }, after: { action: b.action }, ip: clientIp(req) });
  res.json(await q1("SELECT * FROM gn_bulk_batches WHERE id = ?", [batch.id]));
}));

gnBulkRouter.patch("/gn/bulk/rows/:id", requirePerm("gn.bulk.process"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ mapped: z.record(z.string(), z.any()) }).parse(req.body);
  const t = T(req);
  const row = await q1<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!row) { res.status(404).json({ error: "Row not found" }); return; }
  const mapped = { ...safeJson(row.mapped, {}), ...b.mapped };
  const { errors, missing: isMissing } = validateRow(mapped);
  await run("UPDATE gn_bulk_rows SET mapped = ?, validation = ?, status = ?, error = ? WHERE id = ?",
    [JSON.stringify(mapped), JSON.stringify(errors), errors.length === 0 ? "valid" : isMissing ? "missing" : "invalid", errors.length ? errors.map((e) => e.error).join("; ") : null, row.id]);
  if (errors.length) await bulkError(t, row.batch_id, row.id, "invalid_data", `Row ${row.row_no}: ${errors.map((e) => e.error).join("; ")}`, "Fix the highlighted fields and save again");
  res.json(await q1("SELECT * FROM gn_bulk_rows WHERE id = ?", [row.id]));
}));

gnBulkRouter.post("/gn/bulk/rows/:id/ignore", requirePerm("gn.bulk.process"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const row = await q1<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!row) { res.status(404).json({ error: "Row not found" }); return; }
  await run("UPDATE gn_bulk_rows SET status = 'skipped' WHERE id = ?", [row.id]);
  await run("UPDATE gn_bulk_errors SET status = 'ignored' WHERE row_id = ?", [row.id]);
  res.json({ ok: true });
}));

gnBulkRouter.get("/gn/bulk/batches/:id/errors", requirePerm("gn.bulk.view"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  const errors = await q<Record<string, any>>(
    `SELECT e.*, r.row_no FROM gn_bulk_errors e LEFT JOIN gn_bulk_rows r ON r.id = e.row_id
     WHERE e.batch_id = ? ORDER BY e.id DESC LIMIT 300`, [batch.id]);
  res.json({ errors });
}));

gnBulkRouter.post("/gn/bulk/batches/:id/export", requirePerm("gn.bulk.export"), asyncH(async (req: AuthedRequest, res) => {
  const b = z.object({ filter: z.string().optional() }).parse(req.body);
  const t = T(req);
  const batch = await q1<Record<string, any>>("SELECT * FROM gn_bulk_batches WHERE id = ? AND tenant_id = ?", [req.params.id, t]);
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  const where = ["batch_id = ?", b.filter ? "status = ?" : "1 = 1"];
  const params: unknown[] = [batch.id, ...(b.filter ? [b.filter] : [])];
  const rows = await q<Record<string, any>>(`SELECT * FROM gn_bulk_rows WHERE ${where.join(" AND ")} ORDER BY row_no`, params);
  const cols = ["row_no", "status", "error", "applicant_id", "application_id", "mapped"];
  const csv = "\uFEFF" + cols.join(",") + "\n" + rows.map((r) => cols.map((c) => {
    const v = c === "mapped" ? JSON.stringify(safeJson(r.mapped, {})) : r[c];
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.export", entityType: "gn_bulk_batch", entityId: batch.id, after: { filter: b.filter ?? "all", rows: rows.length }, ip: clientIp(req) });
  res.setHeader("Content-Type", "text/csv;charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="bulk_${batch.name.replace(/\s+/g, "_")}_${b.filter ?? "all"}.csv"`);
  res.send(csv);
}));

gnBulkRouter.get("/gn/bulk/template/:type", requirePerm("gn.bulk.view"), asyncH(async (req: AuthedRequest, res) => {
  const tpl: Record<string, string[]> = {
    "personal": ["Name", "Mobile", "Email", "PAN", "DOB", "Employment Type", "Employer", "Monthly Income", "Existing EMI", "Loan Amount", "Tenure", "City", "State"],
    "business": ["Name", "Mobile", "Email", "PAN", "Business Name", "Business Type", "Business Vintage", "Annual Turnover", "GST", "Udyam", "ITR", "Existing EMI", "Loan Amount", "Purpose", "City", "State"],
    "home": ["Name", "Mobile", "Email", "PAN", "DOB", "Monthly Income", "Employer", "Property Type", "Property Value", "Property Location", "Loan Amount", "Tenure", "Existing EMI"],
    "lap": ["Name", "Mobile", "PAN", "Business Name", "Annual Turnover", "Property Type", "Property Value", "Property Location", "Loan Amount", "Tenure"],
    "vehicle": ["Name", "Mobile", "PAN", "Business Name", "Asset Type", "Asset Value", "Down Payment", "Loan Amount", "Business Vintage", "Annual Turnover"],
    "all": ["Name", "Mobile", "Email", "PAN", "DOB", "Gender", "City", "State", "Pincode", "Applicant Type", "Employment Type", "Company", "Business Name", "Business Type", "Business Vintage", "Monthly Income", "Annual Turnover", "GST", "Existing EMI", "Loan Type", "Loan Amount", "Tenure", "Purpose", "Source", "DSA"]
  };
  const cols = tpl[req.params.type] ?? tpl.all;
  res.setHeader("Content-Type", "text/csv;charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="gn_bulk_template_${req.params.type}.csv"`);
  res.send("\uFEFF" + cols.join(",") + "\n" + cols.map(() => "").join(",") + "\n");
}));

/* ================= Demo batch ================= */

gnBulkRouter.post("/gn/bulk/demo", requirePerm("gn.bulk.create"), asyncH(async (req: AuthedRequest, res) => {
  const t = T(req);
  const id = (await run(
    `INSERT INTO gn_bulk_batches (tenant_id, name, description, source, loan_type, assigned_team, priority, mode, status, is_demo, created_by)
     VALUES (?, '500 Applicant Demo Batch', 'Generated relational demo batch — 300 PL · 100 BL · 50 HL · 25 LAP · 15 Vehicle · 10 Equipment (DEMO / SANDBOX)', 'Demo', 'Mixed', 'Demo Processing Team', 'high', 'assisted', 'uploaded', 1, ?)`,
    [t, req.user!.id]
  )).lastId;
  const rows = generateDemoRows(id);
  for (const r of rows) {
    await run(
      "INSERT INTO gn_bulk_rows (tenant_id, batch_id, row_no, raw, mapped, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [t, id, r.row_no, JSON.stringify(r), JSON.stringify(r)]
    );
  }
  await run("UPDATE gn_bulk_batches SET total_rows = ? WHERE id = ?", [rows.length, id]);
  // validate
  for (const row of await q<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE batch_id = ?", [id])) {
    const mapped = safeJson(row.mapped, {});
    const { errors, missing: isMissing } = validateRow(mapped);
    await run("UPDATE gn_bulk_rows SET validation = ?, status = ?, error = ? WHERE id = ?",
      [JSON.stringify(errors), errors.length === 0 ? "valid" : isMissing ? "missing" : "invalid", errors.length ? errors.map((e) => e.error).join("; ") : null, row.id]);
    for (const e of errors) await bulkError(t, id, row.id, "invalid_data", `Row ${row.row_no}: ${e.field} — ${e.error}`, `Correct the ${e.field} value in row ${row.row_no}`);
  }
  // dedupe
  const seenMobiles = new Map<string, number>();
  const seenPans = new Map<string, number>();
  let dupN = 0;
  for (const row of await q<Record<string, any>>("SELECT * FROM gn_bulk_rows WHERE batch_id = ? AND status = 'valid' ORDER BY row_no", [id])) {
    const mapped = safeJson(row.mapped, {});
    const mobile = normMobile(mapped.mobile);
    const pan = mapped.pan ? String(mapped.pan).toUpperCase() : null;
    const inBatch = mobile && seenMobiles.has(mobile) ? `Row ${seenMobiles.get(mobile)} has the same mobile ${mobile}` : pan && seenPans.has(pan) ? `Row ${seenPans.get(pan)} has the same PAN ${pan}` : null;
    if (inBatch) {
      dupN++;
      await run("UPDATE gn_bulk_rows SET status = 'duplicate', error = ? WHERE id = ?", [inBatch, row.id]);
      await bulkError(t, id, row.id, "duplicate", `Row ${row.row_no}: ${inBatch}`, "Create a new application for this existing customer instead");
      continue;
    }
    if (mobile) seenMobiles.set(mobile, row.row_no);
    if (pan) seenPans.set(pan, row.row_no);
  }
  const counts = await q1<Record<string, any>>(
    `SELECT SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END) AS valid,
       SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) AS invalid,
       SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) AS missing,
       SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END) AS duplicates
     FROM gn_bulk_rows WHERE batch_id = ?`, [id])!;
  await run("UPDATE gn_bulk_batches SET status = 'validated', valid = ?, invalid = ?, missing = ?, duplicates = ? WHERE id = ?",
    [counts.valid ?? 0, counts.invalid ?? 0, counts.missing ?? 0, dupN, id]);
  const out = await processBulkBatch(t, id, req.user!.id);
  await audit({ tenantId: t, userId: req.user!.id, action: "gn.bulk.demo", entityType: "gn_bulk_batch", entityId: id, after: { rows: rows.length, ...out }, ip: clientIp(req) });
  res.json({ batchId: id, rows: rows.length, ...counts, processing: out });
}));
