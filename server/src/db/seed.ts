import { q, q1, run, tx } from "./connection.js";
import { createSchema, resetSchema } from "./schema.js";
import { hashPassword } from "../core/auth.js";
import { buildSchedule, computeEmi, computeDpd, allocatePayment, type AllocationComponent } from "../core/finance.js";
import { seedGrowthNations } from "./seed-gn.js";

/* Deterministic RNG so the demo portfolio is reproducible */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MALE = ["Aarav", "Vihaan", "Arjun", "Rohan", "Kabir", "Ishaan", "Aditya", "Kunal", "Rahul", "Amit", "Suresh", "Ramesh", "Vikram", "Sanjay", "Rajesh", "Anil", "Deepak", "Manish", "Nitin", "Prakash", "Sunil", "Vijay", "Ashok", "Dinesh", "Ganesh", "Harish", "Jitendra", "Karthik", "Lakshman", "Mahesh", "Naveen", "Pradeep", "Ravi", "Sandeep", "Tarun", "Uday", "Varun", "Yash", "Abhishek", "Bharat"];
const FEMALE = ["Aanya", "Diya", "Ishita", "Kavya", "Myra", "Ananya", "Priya", "Sneha", "Neha", "Pooja", "Anita", "Sunita", "Kavita", "Rekha", "Meena", "Lata", "Shalini", "Divya", "Ritu", "Pallavi", "Nisha", "Swati", "Anjali", "Vandana", "Deepika", "Rachna", "Seema", "Kiran", "Shweta", "Preeti", "Mamta", "Geeta", "Sangeeta", "Usha", "Radha", "Kamala", "Sharda", "Manju", "Rani", "Asha"];
const LAST = ["Sharma", "Verma", "Gupta", "Mehta", "Patel", "Shah", "Singh", "Kumar", "Reddy", "Nair", "Iyer", "Menon", "Das", "Bose", "Chopra", "Malhotra", "Khan", "Ansari", "Joshi", "Kulkarni", "Deshmukh", "Patil", "Rao", "Murthy", "Aggarwal", "Bansal", "Kapoor", "Khanna", "Saxena", "Tiwari", "Yadav", "Mishra", "Pandey", "Dubey", "Tripathi", "Chauhan", "Rathore", "Shekhawat", "Gill", "Bajwa", "Hegde", "Shetty", "Kamath", "Pillai", "Varghese"];
const CITIES: { city: string; state: string }[] = [
  { city: "Mumbai", state: "Maharashtra" }, { city: "Pune", state: "Maharashtra" }, { city: "Nagpur", state: "Maharashtra" },
  { city: "Delhi", state: "Delhi" }, { city: "Gurugram", state: "Haryana" }, { city: "Noida", state: "Uttar Pradesh" },
  { city: "Bengaluru", state: "Karnataka" }, { city: "Mysuru", state: "Karnataka" },
  { city: "Chennai", state: "Tamil Nadu" }, { city: "Coimbatore", state: "Tamil Nadu" },
  { city: "Hyderabad", state: "Telangana" }, { city: "Vijayawada", state: "Andhra Pradesh" },
  { city: "Kolkata", state: "West Bengal" }, { city: "Ahmedabad", state: "Gujarat" }, { city: "Surat", state: "Gujarat" },
  { city: "Jaipur", state: "Rajasthan" }, { city: "Lucknow", state: "Uttar Pradesh" },
  { city: "Indore", state: "Madhya Pradesh" }, { city: "Bhopal", state: "Madhya Pradesh" },
  { city: "Chandigarh", state: "Punjab" }, { city: "Ludhiana", state: "Punjab" },
  { city: "Patna", state: "Bihar" }, { city: "Ranchi", state: "Jharkhand" }, { city: "Bhubaneswar", state: "Odisha" },
  { city: "Guwahati", state: "Assam" }, { city: "Kochi", state: "Kerala" }, { city: "Thiruvananthapuram", state: "Kerala" },
  { city: "Visakhapatnam", state: "Andhra Pradesh" }, { city: "Nashik", state: "Maharashtra" }, { city: "Vadodara", state: "Gujarat" },
  { city: "Dehradun", state: "Uttarakhand" }, { city: "Bareilly", state: "Uttar Pradesh" }, { city: "Raipur", state: "Chhattisgarh" },
  { city: "Jodhpur", state: "Rajasthan" }, { city: "Kolhapur", state: "Maharashtra" }
];
const LOAN_TYPES = ["personal", "business", "msme", "lap", "home", "vehicle", "working_capital", "invoice", "microfinance", "gold", "education", "consumer", "commercial_vehicle", "supply_chain", "agriculture"];
const SOURCES = ["website", "meta", "google", "whatsapp", "call", "referral", "dsa", "field", "branch", "walkin", "partner", "aggregator"];
const PURPOSES = ["Business expansion", "Working capital", "Debt consolidation", "Home renovation", "New vehicle purchase", "Inventory purchase", "Medical emergency", "Education", "Wedding", "Machinery purchase", "Salary disbursement", "Invoice discounting", "Crop cultivation", "Equipment upgrade", "Store renovation"];
const EMPLOYMENT = ["salaried", "self_employed", "business", "professional"];
const DOC_CATEGORIES = ["pan", "aadhaar", "address_proof", "bank_statement", "gst", "itr", "salary_slip", "business_reg", "property", "vehicle", "agreement", "kfs", "sanction"];

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function monthsBetween(from: Date, to: Date): number { return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()); }
function pick<T>(rng: () => number, arr: T[]): T { return arr[Math.floor(rng() * arr.length)]; }
function range(min: number, max: number, rng: () => number): number { return Math.round(min + rng() * (max - min)); }
function inrShort(n: number): string { return "₹" + n.toLocaleString("en-IN"); }

const STAGES = [
  { code: "application", name: "Application", sla: 24, seq: 1 },
  { code: "kyc", name: "KYC Verification", sla: 12, seq: 2 },
  { code: "documents", name: "Documents", sla: 24, seq: 3 },
  { code: "credit", name: "Credit Bureau", sla: 24, seq: 4 },
  { code: "banking", name: "Bank Analysis", sla: 24, seq: 5 },
  { code: "gst", name: "GST Verification", sla: 24, seq: 6 },
  { code: "bre", name: "Business Rules", sla: 4, seq: 7 },
  { code: "underwriting", name: "Underwriting", sla: 48, seq: 8 },
  { code: "approval", name: "Approval", sla: 24, seq: 9 },
  { code: "sanction", name: "Sanction", sla: 24, seq: 10 },
  { code: "kfs", name: "Key Fact Statement", sla: 12, seq: 11 },
  { code: "agreement", name: "Agreement", sla: 48, seq: 12 },
  { code: "esign", name: "E-Sign", sla: 24, seq: 13 },
  { code: "disbursement", name: "Disbursement", sla: 24, seq: 14 }
];

const PRODUCTS = [
  { code: "PL", name: "Personal Loan", category: "personal", min: 25000, max: 5000000, minT: 6, maxT: 60, rate: 15.5, fee: 2.0 },
  { code: "BL", name: "Business Loan", category: "business", min: 100000, max: 15000000, minT: 12, maxT: 60, rate: 17.5, fee: 2.5 },
  { code: "MSME", name: "MSME Loan", category: "msme", min: 100000, max: 20000000, minT: 12, maxT: 84, rate: 16.5, fee: 2.0 },
  { code: "LAP", name: "Loan Against Property", category: "lap", min: 500000, max: 50000000, minT: 12, maxT: 180, rate: 11.5, fee: 1.5 },
  { code: "HL", name: "Home Loan", category: "home", min: 300000, max: 50000000, minT: 12, maxT: 240, rate: 10.5, fee: 1.0 },
  { code: "VL", name: "Vehicle Loan", category: "vehicle", min: 50000, max: 5000000, minT: 12, maxT: 84, rate: 13.5, fee: 1.5 },
  { code: "WC", name: "Working Capital", category: "working_capital", min: 200000, max: 10000000, minT: 6, maxT: 24, rate: 18.5, fee: 2.0 },
  { code: "INV", name: "Invoice Financing", category: "invoice", min: 100000, max: 5000000, minT: 1, maxT: 12, rate: 19.5, fee: 1.0 },
  { code: "MF", name: "Microfinance Loan", category: "microfinance", min: 10000, max: 300000, minT: 6, maxT: 24, rate: 21.5, fee: 1.0 },
  { code: "GL", name: "Gold Loan", category: "gold", min: 10000, max: 2000000, minT: 3, maxT: 24, rate: 12.5, fee: 0.5 },
  { code: "EL", name: "Education Loan", category: "education", min: 100000, max: 5000000, minT: 12, maxT: 120, rate: 12.5, fee: 1.0 },
  { code: "CL", name: "Consumer Loan", category: "consumer", min: 10000, max: 500000, minT: 6, maxT: 36, rate: 18.0, fee: 1.5 },
  { code: "CV", name: "Commercial Vehicle Loan", category: "commercial_vehicle", min: 200000, max: 20000000, minT: 12, maxT: 84, rate: 12.0, fee: 1.5 },
  { code: "SCF", name: "Supply Chain Finance", category: "supply_chain", min: 200000, max: 5000000, minT: 3, maxT: 12, rate: 17.0, fee: 1.0 },
  { code: "AG", name: "Agriculture Loan", category: "agriculture", min: 50000, max: 2000000, minT: 6, maxT: 36, rate: 11.0, fee: 1.0 },
  { code: "OD", name: "Overdraft Facility", category: "overdraft", min: 100000, max: 5000000, minT: 6, maxT: 12, rate: 19.0, fee: 1.5 },
  { code: "BT", name: "Balance Transfer", category: "balance_transfer", min: 50000, max: 5000000, minT: 12, maxT: 60, rate: 14.0, fee: 1.0 },
  { code: "PLP", name: "Personal Loan Plus", category: "personal", min: 50000, max: 10000000, minT: 6, maxT: 72, rate: 14.5, fee: 1.5 },
  { code: "GLP", name: "Gold Loan Plus", category: "gold", min: 20000, max: 5000000, minT: 3, maxT: 36, rate: 11.5, fee: 0.5 },
  { code: "MSMEX", name: "MSME Expansion", category: "msme", min: 200000, max: 30000000, minT: 12, maxT: 96, rate: 15.5, fee: 1.5 }
];

const INTEGRATIONS = [
  ["cibil", "TransUnion CIBIL", "credit"], ["experian", "Experian", "credit"], ["equifax", "Equifax", "credit"], ["crif", "CRIF High Mark", "credit"],
  ["pan_verify", "PAN Verification", "identity"], ["ckyc", "CKYC", "identity"], ["aadhaar_ovd", "Aadhaar / OVD", "identity"],
  ["gst", "GSTN", "business"], ["mca", "MCA", "business"], ["udyam", "Udyam", "business"],
  ["account_aggregator", "Account Aggregator", "banking"], ["bank_statement", "Bank Statement Parser", "banking"],
  ["upi", "UPI (PG)", "payments"], ["nach", "NACH / eNACH", "payments"], ["neft_imps", "NEFT / IMPS", "payments"],
  ["esign", "E-Sign Provider", "documents"], ["ocr", "OCR Engine", "documents"],
  ["whatsapp", "WhatsApp Business", "communication"], ["sms", "SMS Gateway", "communication"], ["email", "Email Service", "communication"]
];

const COMPLIANCE_RULES = [
  ["DL-01", "Key Fact Statement", "RBI Digital Lending Guidelines", "KFS must disclose APR, fees and amortisation schedule before sanction acceptance"],
  ["DL-02", "APR Disclosure", "RBI Digital Lending Guidelines", "APR including all fees must be communicated to the borrower"],
  ["DL-03", "Consent Management", "RBI Digital Lending Guidelines", "Explicit, informed consent required before data collection or credit bureau fetch"],
  ["DL-04", "Data Minimization", "RBI Digital Lending Guidelines", "Only purpose-limited customer data may be collected"],
  ["DL-05", "Recovery Conduct", "RBI Fair Practices Code", "Recovery agents must follow fair conduct and disclosure norms"],
  ["KYC-01", "Customer Due Diligence", "RBI KYC Master Directions", "CDD for all customers; EDD for high-risk classifications"],
  ["KYC-02", "Re-KYC Cycle", "RBI KYC Master Directions", "Periodic re-KYC per customer risk classification"],
  ["AML-01", "Sanctions Screening", "AML/CFT Framework", "Sanctions and PEP screening on customer onboarding"],
  ["PRIV-01", "Data Residency", "Data Storage Guidelines", "India-region storage for applicable digital lending data"],
  ["GRV-01", "Grievance Redressal", "RBI Integrated Ombudsman Scheme", "Complaints must be acknowledged and resolved within SLA"]
];

export async function seed() {
  const rng = mulberry32(20260811);
  const today = new Date();
  const ten = await q1<{ id: number }>("SELECT id FROM tenants WHERE code = 'NEXUS-DEMO'");
  if (ten) {
    console.log("[NEXUS SEED] demo data already present — use `reset` to reseed");
    return;
  }

  console.log("[NEXUS SEED] building large connected demo dataset (2,000 customers / 750 applications / 500 loans)…");
  const started = Date.now();

  await tx(async () => {
    /* --- tenant + 30 branches --- */
    const tenantId = (await run("INSERT INTO tenants (code, name, branding) VALUES ('NEXUS-DEMO', ?, ?)",
      ["Nexus Demo Finance Pvt Ltd", JSON.stringify({ primary: "#4f46e5", logo: null, demo: true })])).lastId;
    const branchIds: number[] = [];
    const usedCities = new Set<string>();
    let bi = 0;
    while (branchIds.length < 30) {
      const loc = CITIES[Math.floor(rng() * CITIES.length)];
      if (usedCities.has(loc.city)) continue;
      usedCities.add(loc.city);
      bi += 1;
      branchIds.push((await run("INSERT INTO branches (tenant_id, code, name, city, state) VALUES (?, ?, ?, ?, ?)",
        [tenantId, "BR" + String(bi).padStart(3, "0"), `Nexus ${loc.city} Branch`, loc.city, loc.state])).lastId);
    }

    /* --- users: managers + 100 DSA + 100 field + 50 telecallers + 50 credit + 50 agents --- */
    const managerRoles: [string, string, number][] = [
      ["Rakesh Menon", "sales_manager", 1], ["Pooja Reddy", "credit_manager", 2], ["Imran Qureshi", "underwriter", 2],
      ["Farah Khan", "collection_manager", 3], ["Gaurav Bhatt", "operations", 1], ["Sonia Jain", "compliance_officer", 1],
      ["Dev Patel", "finance", 1], ["Ankur Thakur", "branch_admin", 1], ["Meera Krishnan", "branch_admin", 2], ["Sahil Dutta", "branch_admin", 3],
      ["Leela Prasad", "sales_manager", 5], ["Naveen Rao", "credit_manager", 4]
    ];
    const userIds: number[] = [];
    for (const [name, role, bIdx] of managerRoles) {
      const email = name.toLowerCase().replace(/[^a-z]/g, ".") + "@nexus.demo";
      userIds.push((await run("INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
        [tenantId, branchIds[bIdx - 1], name, email, hashPassword("demo1234"), role])).lastId);
    }
    for (let i = 0; i < 50; i++) {
      const name = `${pick(rng, FEMALE)} ${pick(rng, LAST)}`;
      userIds.push((await run("INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'telecaller')",
        [tenantId, pick(rng, branchIds), name, `tc${i}@nexus.demo`, hashPassword("demo1234")])).lastId);
    }
    const dsaIds: number[] = [];
    for (let i = 0; i < 100; i++) {
      const name = `${pick(rng, MALE)} ${pick(rng, LAST)}`;
      const id = (await run("INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role, phone) VALUES (?, NULL, ?, ?, ?, 'dsa', ?)",
        [tenantId, name, `dsa${i}@nexus.demo`, hashPassword("demo1234"), "98" + String(10000000 + Math.floor(rng() * 89999999))])).lastId;
      dsaIds.push(id); userIds.push(id);
    }
    const fieldIds: number[] = [];
    for (let i = 0; i < 100; i++) {
      const name = `${pick(rng, MALE)} ${pick(rng, LAST)}`;
      const id = (await run("INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'field_executive')",
        [tenantId, pick(rng, branchIds), name, `fe${i}@nexus.demo`, hashPassword("demo1234")])).lastId;
      fieldIds.push(id); userIds.push(id);
    }
    const creditIds: number[] = [];
    for (let i = 0; i < 50; i++) {
      const name = `${pick(rng, MALE)} ${pick(rng, LAST)}`;
      const id = (await run("INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'credit_analyst')",
        [tenantId, pick(rng, branchIds), name, `cr${i}@nexus.demo`, hashPassword("demo1234")])).lastId;
      creditIds.push(id); userIds.push(id);
    }
    const agentIds: number[] = [];
    for (let i = 0; i < 50; i++) {
      const name = `${pick(rng, MALE)} ${pick(rng, LAST)}`;
      const id = (await run("INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'collection_agent')",
        [tenantId, pick(rng, branchIds), name, `ca${i}@nexus.demo`, hashPassword("demo1234")])).lastId;
      agentIds.push(id); userIds.push(id);
    }
    const salesIds = userIds.slice(0, 150);

    /* --- 20 products --- */
    const productIds: number[] = [];
    const productMeta: { id: number; def: (typeof PRODUCTS)[number] }[] = [];
    for (const p of PRODUCTS) {
      const id = (await run(
        `INSERT INTO products (tenant_id, code, name, category, min_amount, max_amount, min_tenure, max_tenure, interest_type, interest_rate,
           processing_fee_pct, processing_fee_gst_pct, penal_rate_pct, late_fee_amount, grace_days, prepayment_allowed, foreclosure_charge_pct,
           part_payment_allowed, part_payment_min_amount, emi_frequency, allocation_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reducing', ?, ?, 18, 24, 0, 3, 1, 3, 1, 10000, 'monthly', 'penalty,fees,interest,principal')`,
        [tenantId, p.code, p.name, p.category, p.min, p.max, p.minT, p.maxT, p.rate, p.fee]
      )).lastId;
      productIds.push(id);
      productMeta.push({ id, def: p });
    }

    /* --- workflow stages --- */
    for (const s of STAGES) {
      await run("INSERT INTO workflow_stages (tenant_id, code, name, seq, required_fields, required_documents, sla_hours) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [tenantId, s.code, s.name, s.seq, JSON.stringify([]),
         JSON.stringify(s.code === "kfs" ? ["sanction"] : s.code === "agreement" ? ["kfs"] : s.code === "esign" ? ["agreement"] : s.code === "disbursement" ? ["agreement"] : []),
         s.sla]);
    }

    /* --- 2,000 customers (kept in memory to avoid re-querying) --- */
    const customerRows: Record<string, any>[] = [];
    for (let i = 0; i < 2000; i++) {
      const gender = rng() > 0.4 ? "M" : "F";
      const name = `${pick(rng, gender === "M" ? MALE : FEMALE)} ${pick(rng, LAST)}`;
      const loc = pick(rng, CITIES);
      const emp = pick(rng, EMPLOYMENT);
      const monthlyIncome = emp === "salaried" ? range(18000, 200000, rng) : range(25000, 500000, rng);
      const businessTurnover = emp !== "salaried" ? range(1500000, 60000000, rng) : null;
      const dob = iso(addMonths(new Date(today.getFullYear() - range(23, 58, rng), range(0, 11, rng), range(1, 28, rng)), 0));
      const pan = "ABCDE" + String(1000 + Math.floor(rng() * 8999)) + "F";
      const mobile = "9" + String(100000000 + Math.floor(rng() * 899999999));
      const score = range(520, 860, rng);
      const id = (await run(
        `INSERT INTO customers (tenant_id, customer_no, name, mobile, email, dob, gender, pan, address_line1, city, state, pincode,
           employment_type, business_name, annual_income, monthly_income, business_turnover, credit_score, kyc_status, risk_class)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'standard')`,
        [tenantId, "CUS" + String(10000 + i), name, mobile, `${name.toLowerCase().replace(/[^a-z]/g, ".")}@gmail.com`, dob, gender,
         pan, `${range(1, 99, rng)}, ${pick(rng, ["MG Road", "Gandhi Nagar", "Station Road", "Main Market", "Sector 7", "Laxmi Nagar", "Ring Road", "Tilakwadi", "Koramangala", "Andheri East"])}`, loc.city, loc.state,
         String(100000 + Math.floor(rng() * 899999)), emp, emp !== "salaried" ? `${name} Enterprises` : null,
         monthlyIncome * 12, monthlyIncome, businessTurnover, score]
      )).lastId;
      customerRows.push({ id, name, mobile, email: `${name.toLowerCase().replace(/[^a-z]/g, ".")}@gmail.com`, dob, pan, emp, monthlyIncome, businessTurnover, score, city: loc.city, state: loc.state });
    }

    /* --- 1,500 leads (shuffled pool consumed by applications) --- */
    const leadIds: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const status = rng() < 0.14 ? "converted" : pick(rng, ["new", "assigned", "contacted", "interested", "not_interested", "followup", "dnd", "wrong_number", "lost"]);
      const source = pick(rng, SOURCES);
      const loc = pick(rng, CITIES);
      const amount = range(50000, 4000000, rng);
      const income = range(15000, 300000, rng);
      const created = addDays(today, -range(0, 60, rng));
      const id = (await run(
        `INSERT INTO leads (tenant_id, branch_id, lead_no, name, mobile, email, city, state, loan_type, requested_amount,
           monthly_income, business_turnover, source, campaign, dsa_id, owner_id, status, next_action, followup_at, score, probability, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        [tenantId, pick(rng, branchIds), "LD" + String(1000 + i), `${pick(rng, MALE)} ${pick(rng, LAST)}`,
         "9" + String(100000000 + Math.floor(rng() * 899999999)), `lead${i}@gmail.com`, loc.city, loc.state,
         pick(rng, LOAN_TYPES), amount, income, income * (10 + rng() * 30), source,
         pick(rng, ["Summer Campaign", "Festival Offer", "Business Drive", "WhatsApp Blast", null, null, null]),
         rng() < 0.5 ? pick(rng, dsaIds) : null, rng() < 0.6 ? pick(rng, salesIds) : null, status,
         pick(rng, ["Call back", "Send WhatsApp", "Collect documents", "Schedule visit", "Share KFS", null]),
         rng() < 0.5 ? iso(addDays(created, range(1, 7, rng))) : null, iso(created)]
      )).lastId;
      await run("UPDATE leads SET score = ? WHERE id = ?", [rng() < 0.3 ? range(70, 95, rng) : range(25, 80, rng), id]);
      leadIds.push(id);
    }
    // Shuffle the lead pool once so application→lead links are spread deterministically
    const leadPool = [...leadIds];
    for (let i = leadPool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [leadPool[i], leadPool[j]] = [leadPool[j], leadPool[i]];
    }
    let leadCursor = 0;

    const appSeqState = { n: 0 };
    const nextAppNo = () => { appSeqState.n += 1; return "APP26" + String(100000 + appSeqState.n); };
    const docsByApp: Record<number, string[]> = {};

    /** Attach stage history, documents, KYC/consents, credit data and BRE eval for a pipeline application. */
    async function buildAppSupport(app: Record<string, any>, stageIdx: number, created: Date) {
      const cust = customerRows.find((c) => c.id === app.customer_id)!;
      for (let s = 0; s <= stageIdx; s++) {
        const d = addDays(created, s);
        const entered = iso(d > today ? today : d);
        const exited = s < stageIdx ? iso(addDays(created, s + 1) > today ? today : addDays(created, s + 1)) : null;
        await run("INSERT INTO application_stages (application_id, stage, entered_at, exited_at, status) VALUES (?, ?, ?, ?, ?)",
          [app.id, STAGES[s].code, entered, exited, s < stageIdx ? "completed" : "in_progress"]);
      }
      const docCats: string[] = [];
      if (stageIdx >= 1) docCats.push("pan", "aadhaar");
      if (stageIdx >= 2) docCats.push("address_proof");
      if (stageIdx >= 3) docCats.push("bank_statement");
      if (stageIdx >= 4) docCats.push("itr", "salary_slip");
      if (stageIdx >= 5) docCats.push("gst", "business_reg");
      docsByApp[app.id] = docCats;
      for (const cat of docCats) {
        await run("INSERT INTO documents (tenant_id, customer_id, application_id, category, name, file_path, status, verified_by, verified_at, ocr_confidence) VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?)",
          [tenantId, app.customer_id, app.id, cat, cat.replace(/_/g, " ") + ".pdf", `docs/${app.application_no}/${cat}.pdf`, userIds[0], iso(created), Math.round((85 + rng() * 14) * 10) / 10]);
      }
      if (stageIdx >= 1) {
        const kycStatus = app.status === "rejected" && rng() < 0.3 ? "failed" : "verified";
        await run("INSERT INTO kyc_records (tenant_id, customer_id, type, status, provider, reference_id, result, verified_by, verified_at, expires_at) VALUES (?, ?, 'pan', ?, 'MOCK-PAN', ?, ?, ?, ?, datetime('now', '+365 days'))",
          [tenantId, app.customer_id, kycStatus, "REF" + String(100000 + Math.floor(rng() * 899999)), JSON.stringify({ match: 0.95, sandbox: true }), userIds[0], iso(created)]);
        await run("INSERT INTO kyc_records (tenant_id, customer_id, type, status, provider, reference_id, result, verified_by, verified_at, expires_at) VALUES (?, ?, 'aadhaar', ?, 'MOCK-OVD', ?, ?, ?, ?, datetime('now', '+365 days'))",
          [tenantId, app.customer_id, kycStatus, "REF" + String(100000 + Math.floor(rng() * 899999)), JSON.stringify({ match: 0.96, sandbox: true }), userIds[0], iso(created)]);
        if (kycStatus === "verified") await run("UPDATE customers SET kyc_status = 'verified' WHERE id = ?", [app.customer_id]);
        await run("INSERT INTO consents (tenant_id, customer_id, type, purpose, channel, status) VALUES (?, ?, 'kyc', 'KYC verification', 'portal', 'active')", [tenantId, app.customer_id]);
        await run("INSERT INTO consents (tenant_id, customer_id, type, purpose, channel, status) VALUES (?, ?, 'bureau', 'Credit bureau fetch', 'portal', 'active')", [tenantId, app.customer_id]);
      }
      if (stageIdx >= 3) {
        const score = cust.score;
        const activeAccts = range(2, 10, rng);
        const closedAccts = range(1, 7, rng);
        const dpdMax = score > 750 ? 0 : score > 650 ? Math.round(rng() * 30) : Math.round(rng() * 90);
        await run("INSERT INTO bureau_reports (tenant_id, customer_id, provider, score, score_band, total_accounts, active_accounts, closed_accounts, overdue_accounts, total_outstanding, credit_utilization, enquiries_6m, writeoffs, settlements, dpd_max, repayment_history, data, is_mock) VALUES (?, ?, 'MOCK-CIBIL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
          [tenantId, app.customer_id, score, score >= 750 ? "Excellent (750-900)" : score >= 700 ? "Good (700-749)" : score >= 650 ? "Fair (650-699)" : "Below Average",
           activeAccts + closedAccts, activeAccts, closedAccts, dpdMax > 0 ? range(1, 3, rng) : 0, range(20000, 400000, rng), Math.round(rng() * 80 * 10) / 10, range(0, 6, rng), rng() < 0.1 ? 1 : 0, rng() < 0.15 ? 1 : 0, dpdMax,
           JSON.stringify({}), JSON.stringify({ adapter: "MockCreditAdapter", sandbox: true })]);
        const income = cust.monthlyIncome;
        const expense = Math.round(income * (0.5 + rng() * 0.25));
        const emiOblig = Math.round(range(5000, 30000, rng) / 500) * 500;
        const bounces = rng() < 0.2 ? range(1, 4, rng) : 0;
        await run("INSERT INTO bank_analyses (tenant_id, customer_id, application_id, provider, monthly_income, monthly_expense, avg_balance, emi_obligations, banking_surplus, bounce_count, cash_deposits, turnover, months_analyzed, risk, data) VALUES (?, ?, ?, 'MOCK-BANK', ?, ?, ?, ?, ?, ?, ?, ?, 6, ?, ?)",
          [tenantId, app.customer_id, app.id, income, expense, Math.round(range(15000, 150000, rng) / 1000) * 1000, emiOblig, income - expense - emiOblig, bounces,
           Math.round(rng() * income * 0.4 / 1000) * 1000, Math.round(income * 12 * (0.9 + rng() * 0.4)), bounces > 2 ? "high" : bounces > 0 ? "medium" : "low",
           JSON.stringify({ adapter: "MockBankAdapter", sandbox: true })]);
        if (cust.businessTurnover) {
          await run("INSERT INTO gst_profiles (tenant_id, customer_id, gstin, turnover, filing_status, filing_frequency, tax_liability, declared_vs_banking_pct, risk, data, is_mock) VALUES (?, ?, ?, ?, ?, 'Monthly', ?, ?, ?, ?, 1)",
            [tenantId, app.customer_id, cust.pan.slice(0, 5) + "F" + String(1000 + Math.floor(rng() * 8999)) + "Z5", cust.businessTurnover,
             rng() < 0.85 ? "filed" : "pending", Math.round(cust.businessTurnover * 0.12 / 12), range(70, 110, rng), "low",
             JSON.stringify({ adapter: "MockGSTAdapter", sandbox: true })]);
        }
      }
      if (stageIdx >= 6) {
        const breEligible = app.status === "rejected" ? rng() < 0.3 : rng() < 0.78;
        const breResult = breEligible ? "eligible" : "rejected";
        const riskGrade = !breEligible ? "high" : pick(rng, ["low", "standard", "standard", "medium"]);
        await run("UPDATE applications SET bre_result = ?, risk_grade = ? WHERE id = ?", [breResult, riskGrade, app.id]);
        for (let r = 1; r <= 5; r++) {
          await run("INSERT INTO bre_evaluations (application_id, rule_id, rule_version, passed, result) VALUES (?, ?, 1, ?, ?)",
            [app.id, r, breEligible || r < 5 ? 1 : 0, JSON.stringify({ eligible: breEligible || r < 5, failures: breEligible ? [] : ["credit.score below threshold"] })]);
        }
      }
    }

    /* --- 250 pipeline applications (every LOS stage + rejects) --- */
    const pipelineDist: [string, number][] = [
      ["application", 20], ["kyc", 26], ["documents", 30], ["credit", 22], ["banking", 18], ["gst", 15],
      ["bre", 25], ["underwriting", 22], ["approval", 20], ["sanction", 18], ["kfs", 14], ["agreement", 13],
      ["esign", 10], ["done_rejected", 17]
    ];
    const pipelineAppIds: number[] = [];
    for (const [stage, count] of pipelineDist) {
      for (let k = 0; k < count; k++) {
        const cust = pick(rng, customerRows);
        const prod = pick(rng, productMeta);
        const amount = Math.min(prod.def.max, Math.max(prod.def.min, Math.round(range(prod.def.min, Math.min(prod.def.max, 5000000), rng) / 5000) * 5000));
        const tenure = range(prod.def.minT, Math.min(prod.def.maxT, 60), rng);
        const created = addDays(today, -range(1, 60, rng));
        let leadId: number | null = null;
        if (leadCursor < leadPool.length && rng() < 0.6) {
          leadId = leadPool[leadCursor++];
          await run("UPDATE leads SET customer_id = ? WHERE id = ?", [cust.id, leadId]);
        }
        const status = stage === "done_rejected" ? "rejected" : "in_progress";
        const appStage = stage === "done_rejected" ? "disbursement" : stage;
        const appNo = nextAppNo();
        const id = (await run(
          `INSERT INTO applications (tenant_id, application_no, lead_id, customer_id, product_id, branch_id, dsa_id, sales_officer_id, credit_officer_id,
             source, requested_amount, tenure, purpose, status, stage, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tenantId, appNo, leadId, cust.id, prod.id, pick(rng, branchIds), rng() < 0.4 ? pick(rng, dsaIds) : null,
           rng() < 0.5 ? pick(rng, salesIds) : null, rng() < 0.8 ? pick(rng, creditIds) : null, pick(rng, SOURCES),
           amount, tenure, pick(rng, PURPOSES), status, appStage, iso(created)]
        )).lastId;
        pipelineAppIds.push(id);
        const stageIdx = STAGES.findIndex((s) => s.code === (stage === "done_rejected" ? "disbursement" : stage));
        await buildAppSupport({ id, application_no: appNo, customer_id: cust.id, status, stage: appStage }, stageIdx, created);
        if (stage === "done_rejected") {
          await run("UPDATE applications SET decision = 'reject', decision_by = ?, decision_at = ?, decision_note = 'Policy deviation — declined', status = 'rejected' WHERE id = ?",
            [userIds[2], iso(created), id]);
        }
      }
    }

    /* --- 500 approved applications → loans (every record connected: docs→credit→BRE→approval→sanction→KFS→agreement→loan) --- */
    const approvedApps: Record<string, any>[] = [];
    for (let i = 0; i < 500; i++) {
      const cust = pick(rng, customerRows);
      const prod = pick(rng, productMeta);
      const amount = Math.min(prod.def.max, Math.max(prod.def.min, Math.round(range(prod.def.min, Math.min(prod.def.max, 4000000), rng) / 10000) * 10000));
      const tenure = range(prod.def.minT, Math.min(prod.def.maxT, 60), rng);
      const created = addDays(today, -range(60, 420, rng));
      let leadId: number | null = null;
      if (leadCursor < leadPool.length) {
        leadId = leadPool[leadCursor++];
        await run("UPDATE leads SET customer_id = ?, status = 'converted', probability = 100 WHERE id = ?", [cust.id, leadId]);
      }
      const appNo = nextAppNo();
      const id = (await run(
        `INSERT INTO applications (tenant_id, application_no, lead_id, customer_id, product_id, branch_id, dsa_id, sales_officer_id, credit_officer_id,
           source, requested_amount, approved_amount, tenure, purpose, status, stage, created_at, bre_result, risk_grade, decision, decision_by, decision_at, decision_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'disbursement', ?, 'eligible', 'standard', 'approve', ?, ?, 'Approved per credit policy')`,
        [tenantId, appNo, leadId, cust.id, prod.id, pick(rng, branchIds), rng() < 0.35 ? pick(rng, dsaIds) : null,
         rng() < 0.5 ? pick(rng, salesIds) : null, pick(rng, creditIds), pick(rng, SOURCES),
         amount, Math.round(amount * 0.95), tenure, pick(rng, PURPOSES), iso(created), userIds[2], iso(created)]
      )).lastId;
      const app = { id, application_no: appNo, customer_id: cust.id, status: "approved", stage: "disbursement", product: prod, amount: Math.round(amount * 0.95), tenure, created, cust };
      approvedApps.push(app);
      await buildAppSupport(app, 13, created);
      // approval record + sanction + kfs + agreement rows
      await run("INSERT INTO approvals (tenant_id, entity_type, entity_id, action, status, by_user, note) VALUES (?, 'application', ?, 'approve', 'approved', ?, 'Credit memo reviewed')",
        [tenantId, id, userIds[2]]);
      const sanctionNo = "SNC26" + String(10000 + i);
      await run("INSERT INTO sanctions (application_id, sanction_no, amount, tenure, rate, emi, fees_json, conditions, status, issued_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)",
        [id, sanctionNo, app.amount, tenure, prod.def.rate, computeEmi(app.amount, prod.def.rate, tenure),
         JSON.stringify({ processing_fee: Math.round(app.amount * prod.def.fee / 100), processing_fee_gst: Math.round(app.amount * prod.def.fee / 100 * 0.18) }),
         JSON.stringify(["Standard terms apply"]), iso(created), iso(addDays(created, 2))]);
      const kfsContent = {
        kfs_id: "KFS-" + appNo + "-v1", borrower: cust.name, loan_amount: app.amount, tenure_months: tenure,
        annual_interest_rate: prod.def.rate, interest_type: "reducing", emi: computeEmi(app.amount, prod.def.rate, tenure),
        repayment_frequency: "monthly", first_repayment_date: iso(addMonths(created, 1)),
        total_interest: Math.round(app.amount * prod.def.rate / 100 * tenure / 12),
        total_fees: Math.round(app.amount * prod.def.fee / 100 * 1.18),
        fee_breakup: { processing_fee: Math.round(app.amount * prod.def.fee / 100), processing_fee_gst: Math.round(app.amount * prod.def.fee / 100 * 0.18) },
        apr: Math.round(prod.def.rate * 1.25 * 100) / 100, apr_disclosure: `Annual Percentage Rate (including fees): ~${Math.round(prod.def.rate * 1.25 * 100) / 100}%`,
        compliance_status: "compliant", blockers: [], notes: ["Fees and APR disclosed", "Amortization schedule provided"],
        generated_at: iso(created), is_mock: true, sandbox: true
      };
      await run("INSERT INTO kfs_documents (application_id, version, content, status, generated_at, disclosed_at, acknowledged_at) VALUES (?, 1, ?, 'acknowledged', ?, ?, ?)",
        [id, JSON.stringify(kfsContent), iso(created), iso(addDays(created, 2)), iso(addDays(created, 3))]);
      await run("INSERT INTO agreements (application_id, template, status, signed_at, signer_name, hash, provider) VALUES (?, 'loan_agreement_v1', 'signed', ?, ?, ?, 'SANDBOX-ESIGN')",
        [id, iso(addDays(created, 4)), cust.name, "SHA256:" + appNo.slice(-12) + ":SANDBOX"]);
      for (const cat of ["sanction", "kfs", "agreement"]) {
        await run("INSERT INTO documents (tenant_id, customer_id, application_id, category, name, file_path, status, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?)",
          [tenantId, cust.id, id, cat, cat.replace(/_/g, " ") + ".pdf", `docs/${appNo}/${cat}.pdf`, userIds[0], iso(created)]);
      }
      docsByApp[id] = [...(docsByApp[id] ?? []), "sanction", "kfs", "agreement"];
    }

    /* --- 500 loans from approved applications, with realistic DPD bands --- */
    const buckets: ("healthy" | "b30" | "b60" | "b90" | "b120" | "closed")[] = [];
    for (let i = 0; i < 500; i++) {
      const r = rng();
      buckets.push(r < 0.60 ? "healthy" : r < 0.70 ? "b30" : r < 0.76 ? "b60" : r < 0.79 ? "b90" : r < 0.82 ? "b120" : "closed");
    }
    const missWindow: Record<string, [number, number]> = {
      healthy: [-1, -1], b30: [12, 28], b60: [38, 58], b90: [68, 88], b120: [100, 150], closed: [-1, -1]
    };
    const order = ["penalty", "fees", "interest", "principal"] as AllocationComponent[];
    const loanIds: number[] = [];
    let paymentCount = 0;
    let installmentCount = 0;
    let collectionCount = 0;

    for (let i = 0; i < 500; i++) {
      const bucket = buckets[i];
      const src = approvedApps[i];
      const { cust, product: prod, amount, tenure } = src;
      const isClosed = bucket === "closed";
      const monthsSince = isClosed ? range(14, 36, rng) : bucket === "healthy" ? range(3, 24, rng) : range(6, 20, rng);
      const effectiveTenure = isClosed ? Math.min(tenure, monthsSince) : tenure;
      const disbursed = addMonths(today, -monthsSince);
      const emi = computeEmi(amount, prod.def.rate, effectiveTenure);
      const riskGrade = bucket === "healthy" ? pick(rng, ["low", "standard", "standard"]) : bucket === "b30" ? "standard" : bucket === "b60" ? "medium" : "high";
      const loanNo = "LN26" + String(100000 + i);
      const loanId = (await run(
        `INSERT INTO loans (tenant_id, loan_no, application_id, customer_id, product_id, branch_id, principal, rate, tenure, emi, disbursed_at, first_emi_at, status, outstanding, risk_grade, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [tenantId, loanNo, src.id, cust.id, prod.id, pick(rng, branchIds), amount, prod.def.rate, effectiveTenure, emi, iso(disbursed), iso(addMonths(disbursed, 1)), amount, riskGrade, iso(disbursed)]
      )).lastId;
      loanIds.push(loanId);

      const schedule = buildSchedule({ principal: amount, annualRatePct: prod.def.rate, tenure: effectiveTenure, firstDueDate: iso(addMonths(disbursed, 1)) });
      for (const row of schedule) {
        await run("INSERT INTO installments (loan_id, seq, due_date, principal, interest, fees, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
          [loanId, row.seq, row.dueDate, row.principal, row.interest, row.fees, row.total]);
        installmentCount++;
      }
      const instRows = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [loanId]);
      const instBySeq = new Map(instRows.map((x) => [x.seq, x]));
      const [wMin, wMax] = missWindow[bucket];
      const missedSince = wMin >= 0 ? iso(addDays(today, -range(wMin, wMax, rng))) : null;
      let missed = 0;
      for (const inst of instRows) {
        if (inst.due_date > iso(today)) continue;
        if (missedSince && inst.due_date >= missedSince) {
          missed += 1;
          const dl = Math.max(0, Math.round((today.getTime() - new Date(inst.due_date + "T00:00:00").getTime()) / 86400000));
          await run("UPDATE installments SET status = 'overdue', days_late = ? WHERE id = ?", [dl, inst.id]);
        } else {
          const paidAt = iso(addDays(new Date(inst.due_date + "T00:00:00"), range(0, bucket === "healthy" || isClosed ? 3 : 20, rng)));
          const daysLate = Math.max(0, Math.round((new Date(paidAt).getTime() - new Date(inst.due_date + "T00:00:00").getTime()) / 86400000));
          const lateFee = daysLate > 3 ? 200 : 0;
          const totalWithFee = inst.total + lateFee;
          const receiptNo = "RCT26" + String(i * 100 + inst.seq);
          const payId = (await run(
            "INSERT INTO payments (tenant_id, loan_id, customer_id, receipt_no, amount, mode, reference, status, received_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)",
            [tenantId, loanId, cust.id, receiptNo, totalWithFee, pick(rng, ["upi", "neft", "nach", "upi", "imps"]), "DEMO-" + String(range(1000, 9999, rng)), paidAt + "T10:00:00", pick(rng, agentIds)]
          )).lastId;
          paymentCount++;
          const alloc = allocatePayment({ amount: totalWithFee, order, penalDue: lateFee > 0 ? lateFee : 0, feesDue: 0, installments: instRows.map((x) => ({ seq: x.seq, total: x.total, paidAmount: x.paid_amount, interest: x.interest, principal: x.principal })), allowFuturePrincipal: true });
          for (const a of alloc.allocations) {
            await run("INSERT INTO payment_allocations (payment_id, installment_id, component, amount) VALUES (?, ?, ?, ?)", [payId, a.seq ?? null, a.component, a.amount]);
            const target = instBySeq.get(a.seq ?? -1);
            if (target && a.component !== "penalty") await run("UPDATE installments SET paid_amount = paid_amount + ? WHERE id = ?", [a.amount, target.id]);
          }
          await run("UPDATE installments SET paid = 1, status = 'paid', paid_at = ?, days_late = ? WHERE id = ?", [paidAt, daysLate, inst.id]);
          if (lateFee > 0) { await run("INSERT INTO charge_events (tenant_id, loan_id, kind, amount, reason) VALUES (?, ?, 'late_fee', ?, 'Late payment fee')", [tenantId, loanId, lateFee]); collectionCount++; }
          await run("INSERT INTO loan_events (tenant_id, loan_id, kind, amount, reference, data) VALUES (?, ?, 'payment', ?, ?, ?)",
            [tenantId, loanId, totalWithFee, receiptNo, JSON.stringify({ sandbox: true })]);
        }
      }
      const dueInfo = computeDpd(await q<{ dueDate: string; paid: number; paidAmount: number }>("SELECT due_date AS dueDate, paid, paid_amount AS paidAmount FROM installments WHERE loan_id = ?", [loanId]), iso(today));
      const npaClass = dueInfo.daysLate >= 90 ? "NPA" : null;
      const unpaidPrincipal = await q1<{ s: number }>("SELECT COALESCE(SUM(principal), 0) AS s FROM installments WHERE loan_id = ? AND paid = 0", [loanId]);
      const allPaid = instRows.length > 0 && instRows.every((i) => i.paid === 1);
      const status = allPaid ? "closed" : missed > 0 ? "overdue" : "active";
      await run("UPDATE loans SET dpd = ?, npa_class = ?, status = ?, outstanding = ?, closed_at = CASE WHEN ? THEN ? ELSE NULL END, updated_at = datetime('now') WHERE id = ?",
        [dueInfo.missedInstallments, npaClass, status, unpaidPrincipal!.s, allPaid ? 1 : 0, allPaid ? iso(today) : null, loanId]);
      if (allPaid) await run("INSERT INTO loan_events (tenant_id, loan_id, kind, amount, reference, data) VALUES (?, ?, 'closure', 0, ?, ?)", [tenantId, loanId, loanNo, JSON.stringify({ kind: "natural_maturity" })]);

      // Collection storyline on stressed buckets (PTPs, tasks, charges, settlements, write-offs)
      if (bucket === "b30" || bucket === "b60" || bucket === "b90" || bucket === "b120") {
        const firstUnpaid = instRows.find((i) => i.paid === 0);
        for (let t = 0; t < 6; t++) {
          await run("INSERT INTO collection_tasks (tenant_id, loan_id, customer_id, agent_id, priority, kind, status, note, due_at) VALUES (?, ?, ?, ?, ?, ?, 'open', 'Follow-up on overdue EMI', ?)",
            [tenantId, loanId, cust.id, pick(rng, agentIds), bucket === "b120" ? "critical" : bucket === "b90" ? "high" : bucket === "b60" ? "medium" : "low",
             pick(rng, ["call", "visit", "whatsapp"]), iso(addDays(today, t + 1))]);
          collectionCount++;
        }
        for (let p = 0; p < 3; p++) {
          await run("INSERT INTO ptps (loan_id, customer_id, amount, due_date, status, agent_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [loanId, cust.id, Math.round((firstUnpaid?.total ?? 5000) * (0.8 + rng() * 0.3)), iso(addDays(today, range(1, 10, rng))),
             p === 0 ? (bucket === "b90" || bucket === "b120" ? "broken" : "kept") : pick(rng, ["promised", "promised", "broken", "kept"]),
             pick(rng, agentIds), "PTP recorded during collection call"]);
          collectionCount++;
        }
        if (bucket === "b60" || bucket === "b90" || bucket === "b120") {
          await run("INSERT INTO charge_events (tenant_id, loan_id, kind, amount, reason) VALUES (?, ?, 'penal_interest', ?, 'Penal interest on overdue')", [tenantId, loanId, range(500, 3000, rng)]);
          collectionCount++;
          await run("INSERT INTO loan_events (tenant_id, loan_id, kind, amount, data) VALUES (?, ?, 'charge', ?, ?)", [tenantId, loanId, range(500, 3000, rng), JSON.stringify({ kind: "penal_interest" })]);
        }
      }
      if (bucket === "b120") {
        if (i % 3 === 0) {
          await run("INSERT INTO settlements (loan_id, requested_amount, status) VALUES (?, ?, 'requested')", [loanId, Math.round(((await q1<{ s: number }>("SELECT COALESCE(SUM(total), 0) AS s FROM installments WHERE loan_id = ? AND paid = 0", [loanId]))!.s) * 0.6)]);
          collectionCount++;
        } else {
          await run("INSERT INTO writeoffs (loan_id, amount, reason, status) VALUES (?, ?, 'Unrecoverable — long overdue', 'requested')", [loanId, unpaidPrincipal!.s]);
          collectionCount++;
        }
      }
      await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'Loan disbursed', ?)", [tenantId, `${loanNo} of ${inrShort(amount)} disbursed`]);
      if (missed > 0) await run("INSERT INTO notifications (tenant_id, title, body) VALUES (?, 'EMI overdue', ?)", [tenantId, `${loanNo}: ${missed} installment(s) overdue — DPD ${dueInfo.bucket}`]);
    }

    /* --- portal demo customer: linked account, live application + active loan --- */
    const portalCust = customerRows[0];
    await run(
      `INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role, customer_id)
       VALUES (?, NULL, 'Kabir Joshi', 'customer@nexus.demo', ?, 'customer', ?)
       ON CONFLICT(email) DO UPDATE SET customer_id = excluded.customer_id, name = excluded.name`,
      [tenantId, hashPassword("demo1234"), portalCust.id]
    );
    await run("UPDATE customers SET kyc_status = 'verified', risk_class = 'standard' WHERE id = ?", [portalCust.id]);
    // Portal application at KFS stage
    const portalAppNo = nextAppNo();
    const portalAppId = (await run(
      `INSERT INTO applications (tenant_id, application_no, customer_id, product_id, branch_id, source, requested_amount, approved_amount, tenure, purpose, status, stage, created_at, rate, bre_result, risk_grade)
       VALUES (?, ?, ?, ?, ?, 'customer_portal', 500000, 475000, 36, 'Home renovation', 'in_progress', 'kfs', datetime('now', '-12 days'), 15.5, 'eligible', 'standard')`,
      [tenantId, portalAppNo, portalCust.id, productIds[0], branchIds[0]]
    )).lastId;
    for (let s = 0; s < 10; s++) {
      const entered = iso(addDays(today, -12 + s));
      await run("INSERT INTO application_stages (application_id, stage, entered_at, exited_at, status) VALUES (?, ?, ?, ?, ?)",
        [portalAppId, STAGES[s].code, entered, s < 9 ? iso(addDays(today, -11 + s)) : null, s < 9 ? "completed" : "in_progress"]);
    }
    for (const cat of ["pan", "aadhaar", "address_proof", "bank_statement", "itr"]) {
      await run("INSERT INTO documents (tenant_id, customer_id, application_id, category, name, file_path, status, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?)",
        [tenantId, portalCust.id, portalAppId, cat, cat + ".pdf", `docs/${portalAppNo}/${cat}.pdf`, userIds[0], iso(addDays(today, -10))]);
    }
    await run("INSERT INTO kyc_records (tenant_id, customer_id, type, status, provider, reference_id, result, verified_by, verified_at, expires_at) VALUES (?, ?, 'pan', 'verified', 'MOCK-PAN', ?, ?, ?, datetime('now', '-9 days'), datetime('now', '+365 days'))",
      [tenantId, portalCust.id, "REF" + String(100000 + Math.floor(rng() * 899999)), JSON.stringify({ match: 0.97, sandbox: true }), userIds[0]]);
    await run("INSERT INTO bureau_reports (tenant_id, customer_id, provider, score, score_band, total_accounts, active_accounts, closed_accounts, overdue_accounts, total_outstanding, credit_utilization, enquiries_6m, dpd_max, data, is_mock) VALUES (?, ?, 'MOCK-CIBIL', 748, 'Good (700-749)', 6, 3, 3, 0, 240000, 42, 2, 0, ?, 1)",
      [tenantId, portalCust.id, JSON.stringify({ adapter: "MockCreditAdapter", sandbox: true })]);
    await run("INSERT INTO bank_analyses (tenant_id, customer_id, application_id, provider, monthly_income, monthly_expense, avg_balance, emi_obligations, banking_surplus, bounce_count, turnover, months_analyzed, risk, data) VALUES (?, ?, ?, 'MOCK-BANK', 85000, 42000, 94000, 18000, 25000, 0, 1800000, 6, 'low', ?)",
      [tenantId, portalCust.id, portalAppId, JSON.stringify({ adapter: "MockBankAdapter", sandbox: true })]);
    await run("INSERT INTO bre_evaluations (application_id, rule_id, rule_version, passed, result) VALUES (?, 1, 1, 1, ?)", [portalAppId, JSON.stringify({ eligible: true })]);
    const portalSanction = (await run("INSERT INTO sanctions (application_id, sanction_no, amount, tenure, rate, emi, fees_json, conditions, status, issued_at) VALUES (?, 'SNC-PORTAL', 475000, 36, 15.5, ?, ?, '[]', 'issued', datetime('now', '-5 days'))",
      [portalAppId, computeEmi(475000, 15.5, 36), JSON.stringify({ processing_fee: 9500, processing_fee_gst: 1710 })])).lastId;
    (await run("INSERT INTO kfs_documents (application_id, version, content, status, generated_at, disclosed_at) VALUES (?, 1, ?, 'generated', datetime('now', '-4 days'), datetime('now', '-4 days'))",
      [portalAppId, JSON.stringify({
        kfs_id: "KFS-" + portalAppNo + "-v1", borrower: portalCust.name, loan_amount: 475000, tenure_months: 36,
        annual_interest_rate: 15.5, interest_type: "reducing", emi: computeEmi(475000, 15.5, 36), repayment_frequency: "monthly",
        first_repayment_date: iso(addMonths(today, 1)), total_interest: 0, total_fees: 11210, total_repayment: 0,
        apr: 19.4, apr_disclosure: "Annual Percentage Rate (including fees): 19.4%",
        fee_breakup: { processing_fee: 9500, processing_fee_gst: 1710 },
        compliance_status: "compliant", blockers: [], notes: ["Fees and APR disclosed"], sandbox: true
      })])).lastId;

    // Portal active loan — 8 of 24 EMIs paid, next due in a few days
    const portalLoanNo = "LN26" + String(100000 + 500);
    const pAmount = 400000, pRate = 15.5, pTenure = 24;
    const pEmi = computeEmi(pAmount, pRate, pTenure);
    const pDisbursed = addMonths(today, -9);
    const portalLoanId = (await run(
      `INSERT INTO loans (tenant_id, loan_no, application_id, customer_id, product_id, branch_id, principal, rate, tenure, emi, disbursed_at, first_emi_at, status, outstanding, risk_grade)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'standard')`,
      [tenantId, portalLoanNo, portalAppId, portalCust.id, productIds[0], branchIds[0], pAmount, pRate, pTenure, pEmi, iso(pDisbursed), iso(addMonths(pDisbursed, 1)), pAmount]
    )).lastId;
    loanIds.push(portalLoanId);
    const pSchedule = buildSchedule({ principal: pAmount, annualRatePct: pRate, tenure: pTenure, firstDueDate: iso(addMonths(pDisbursed, 1)) });
    for (const row of pSchedule) {
      await run("INSERT INTO installments (loan_id, seq, due_date, principal, interest, fees, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')", [portalLoanId, row.seq, row.dueDate, row.principal, row.interest, row.fees, row.total]);
      installmentCount++;
    }
    const pInsts = await q<Record<string, any>>("SELECT * FROM installments WHERE loan_id = ? ORDER BY seq", [portalLoanId]);
    for (const inst of pInsts) {
      if (inst.due_date > iso(today)) continue;
      const paidAt = iso(addDays(new Date(inst.due_date + "T00:00:00"), 2));
      const receiptNo = "RCT" + String(90000 + inst.seq);
      const payId = (await run("INSERT INTO payments (tenant_id, loan_id, customer_id, receipt_no, amount, mode, reference, status, received_at, recorded_by) VALUES (?, ?, ?, ?, ?, 'upi', 'DEMO-UPI', 'received', ?, ?)",
        [tenantId, portalLoanId, portalCust.id, receiptNo, inst.total, paidAt + "T09:30:00", userIds[0]])).lastId;
      paymentCount++;
      await run("INSERT INTO payment_allocations (payment_id, installment_id, component, amount) VALUES (?, ?, 'interest', ?)", [payId, inst.id, inst.interest]);
      await run("INSERT INTO payment_allocations (payment_id, installment_id, component, amount) VALUES (?, ?, 'principal', ?)", [payId, inst.id, inst.principal]);
      await run("UPDATE installments SET paid = 1, status = 'paid', paid_amount = ?, paid_at = ?, days_late = 0 WHERE id = ?", [inst.total, paidAt, inst.id]);
      await run("INSERT INTO loan_events (tenant_id, loan_id, kind, amount, reference, data) VALUES (?, ?, 'payment', ?, ?, ?)", [tenantId, portalLoanId, inst.total, receiptNo, JSON.stringify({ sandbox: true })]);
    }
    await run("UPDATE loans SET outstanding = (SELECT COALESCE(SUM(principal), 0) FROM installments WHERE loan_id = ? AND paid = 0), dpd = 0 WHERE id = ?", [portalLoanId, portalLoanId]);

    /* --- BRE rules --- */
    const rules: [string, string, string, number, any, any][] = [
      ["BRE-CREDIT-01", "Minimum Credit Score", "credit_policy", 10, { operator: "and", children: [{ operator: "gte", field: "credit.score", value: 650 }] }, { eligible: true, riskGrade: "high", reason: "Credit score below 650" }],
      ["BRE-FOIR-01", "FOIR within 55%", "credit_policy", 20, { operator: "lte", field: "capacity.foir", value: 55 }, { eligible: true, riskGrade: "high", reason: "FOIR exceeds 55%" }],
      ["BRE-AGE-01", "Borrower age 21–65", "credit_policy", 30, { operator: "between", field: "customer.age", min: 21, max: 65 }, { eligible: true, reason: "Age outside policy band" }],
      ["BRE-INCOME-01", "Minimum income ₹20,000", "credit_policy", 40, { operator: "gte", field: "customer.monthly_income", value: 20000 }, { eligible: true, reason: "Income below ₹20,000" }],
      ["BRE-DPD-01", "No DPD above 30 in bureau", "credit_policy", 50, { operator: "lte", field: "credit.dpd_max", value: 30 }, { eligible: true, riskGrade: "high", reason: "Bureau DPD above 30 days" }],
      ["BRE-EXPOSURE-01", "Existing exposure cap", "credit_policy", 60, { operator: "lte", field: "exposure.total", value: 2500000 }, { eligible: true, reason: "Existing exposure exceeds cap" }],
      ["BRE-BANK-01", "Bank statement hygiene", "credit_policy", 70, { operator: "lte", field: "bank.bounce_count", value: 2 }, { eligible: true, reason: "Excessive cheque bounces" }],
      ["BRE-UTIL-01", "Credit utilization below 90%", "credit_policy", 80, { operator: "lte", field: "credit.utilization", value: 90 }, { eligible: true, reason: "High credit utilization" }],
      ["REG-KFS-01", "KFS required before acceptance", "regulatory", 5, { operator: "eq", field: "application.stage", value: "kfs" }, { eligible: true, reason: "KFS must be generated and disclosed" }]
    ];
    for (const [code, name, category, priority, conditions, action] of rules) {
      await run("INSERT INTO bre_rules (tenant_id, code, name, category, version, priority, conditions, action, status, created_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'active', ?)",
        [tenantId, code, name, category, priority, JSON.stringify(conditions), JSON.stringify(action), userIds[0]]);
    }
    await run("INSERT INTO bre_rules (tenant_id, code, name, category, version, priority, conditions, action, status, created_by) VALUES (?, 'BRE-POLICY-SIM', 'Proposed FOIR 50% (draft)', 'credit_policy', 1, 15, ?, ?, 'draft', ?)",
      [tenantId, JSON.stringify({ operator: "lte", field: "capacity.foir", value: 50 }), JSON.stringify({ eligible: true, reason: "Draft rule for policy simulation" }), userIds[0]]);

    /* --- integrations (sandbox) --- */
    for (const [code, name, category] of INTEGRATIONS) {
      await run("INSERT INTO integrations (tenant_id, code, name, category, provider, status, config) VALUES (?, ?, ?, ?, ?, 'sandbox', ?)",
        [tenantId, code, name, category, "MOCK-" + code.toUpperCase(), JSON.stringify({ sandbox: true, demo: true })]);
    }

    /* --- compliance rules + events --- */
    for (const [rid, name, source, config] of COMPLIANCE_RULES) {
      await run("INSERT INTO compliance_rules (tenant_id, rule_id, name, source, effective_from, version, status, config) VALUES (?, ?, ?, ?, date('now', '-90 days'), 1, 'active', ?)",
        [tenantId, rid, name, source, JSON.stringify({ description: config })]);
    }
    for (let i = 0; i < 40; i++) {
      const c = pick(rng, customerRows);
      await run("INSERT INTO consents (tenant_id, customer_id, type, purpose, channel, status) VALUES (?, ?, 'communication', 'Transaction and service updates', 'sms', 'active')", [tenantId, c.id]);
      await run("INSERT INTO consents (tenant_id, customer_id, type, purpose, channel, status) VALUES (?, ?, 'marketing', 'Product offers', 'whatsapp', 'active')", [tenantId, c.id]);
    }
    for (let i = 0; i < 12; i++) {
      const c = pick(rng, customerRows);
      await run("INSERT INTO complaints (tenant_id, customer_id, complaint_no, category, priority, status, subject, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [tenantId, c.id, "GRV26" + String(1000 + i), pick(rng, ["Disbursement", "Statement", "Payment", "KYC", "Portal"]), pick(rng, ["low", "medium", "high"]),
         pick(rng, ["open", "in_progress", "resolved", "resolved"]), "Customer service request", "Synthetic demo complaint record"]);
    }

    /* --- system config: approval matrix, NPA policy, KFS policy, eligibility policy --- */
    await run("INSERT INTO system_config (tenant_id, key, value) VALUES (?, 'approval_matrix', ?)", [tenantId, JSON.stringify([
      { upTo: 500000, role: "sales_manager", label: "Sales / Credit Manager" },
      { upTo: 2000000, role: "credit_manager", label: "Credit Manager" },
      { upTo: 5000000, role: "credit_manager", label: "Regional Credit Head" },
      { upTo: 999999999, role: "credit_manager", label: "Credit Committee" }
    ])]);
    await run("INSERT INTO system_config (tenant_id, key, value) VALUES (?, 'npa_policy', ?)", [tenantId, JSON.stringify({ npa_days: 90, substandard_days: 180, policy: "90-day NPA classification per regulatory/accounting policy (configurable)" })]);
    await run("INSERT INTO system_config (tenant_id, key, value) VALUES (?, 'kfs_policy', ?)", [tenantId, JSON.stringify({ require_kfs_before_acceptance: true, apr_disclosure: true, schedule_disclosure: true, charge_disclosure: true })]);
    await run("INSERT INTO system_config (tenant_id, key, value) VALUES (?, 'eligibility_policy', ?)", [tenantId, JSON.stringify({ min_income: 20000, max_foir: 55, min_score: 650, max_exposure: 2500000, ltv: { lap: 65, home: 80, vehicle: 85, gold: 75, commercial_vehicle: 85 } })]);

    /* --- payment reconciliation demo scenario: 10 matched / 5 unmatched / 2 duplicate / 2 failed / 1 reversed --- */
    const reconPayments = await q<Record<string, any>>(
      `SELECT p.*, c.name AS customer_name FROM payments p JOIN customers c ON c.id = p.customer_id
       WHERE p.tenant_id = ? AND p.status = 'received' AND p.reversed = 0 ORDER BY p.id LIMIT 40`, [tenantId]);
    const batchId = (await run("INSERT INTO recon_batches (tenant_id, batch_no, source, total_transactions, total_amount, status, imported_by) VALUES (?, 'RCN-DEMO-01', 'HDFC Settlement (Demo)', 20, ?, 'imported', ?)",
      [tenantId, reconPayments.slice(0, 10).reduce((s, p) => s + p.amount, 0), userIds[0]])).lastId;
    const addRecon = async (tx: Record<string, any>) => await run(
      "INSERT INTO recon_transactions (tenant_id, batch_id, txn_date, amount, mode, reference, account_suffix, payer_name, status, match_type, payment_id, loan_id, customer_id, confidence, reconciled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [tenantId, batchId, tx.txn_date, tx.amount, tx.mode, tx.reference ?? null, tx.account_suffix ?? null, tx.payer_name ?? null,
       tx.status, tx.match_type ?? null, tx.payment_id ?? null, tx.loan_id ?? null, tx.customer_id ?? null, tx.confidence ?? null, tx.reconciled_at ?? null]);
    let rn = 0;
    for (const p of reconPayments.slice(0, 10)) {
      rn += 1;
      await addRecon({ txn_date: p.received_at?.slice(0, 10), amount: p.amount, mode: "NEFT", reference: p.reference || p.receipt_no, account_suffix: "3344", payer_name: p.customer_name, status: "matched", match_type: "auto_reference", payment_id: p.id, loan_id: p.loan_id, customer_id: p.customer_id, confidence: 1, reconciled_at: p.received_at });
    }
    for (let i = 0; i < 5; i++) {
      rn += 1;
      const cust = pick(rng, customerRows);
      await addRecon({ txn_date: iso(addDays(today, -i)), amount: range(3000, 45000, rng), mode: "UPI", reference: "UPI" + String(400000 + Math.floor(rng() * 599999)), account_suffix: "9911", payer_name: cust.name, status: "unmatched", match_type: "none" });
    }
    const dupBase = reconPayments[5];
    await addRecon({ txn_date: iso(addDays(today, -2)), amount: dupBase.amount, mode: "NEFT", reference: dupBase.reference || dupBase.receipt_no, account_suffix: "3344", payer_name: "SAME REFERENCE", status: "duplicate", match_type: "auto_reference", payment_id: dupBase.id, confidence: 1 });
    await addRecon({ txn_date: iso(addDays(today, -3)), amount: dupBase.amount, mode: "NEFT", reference: dupBase.reference || dupBase.receipt_no, account_suffix: "7788", payer_name: "DUPLICATE ENTRY", status: "duplicate", match_type: "auto_reference", payment_id: dupBase.id, confidence: 1 });
    for (let i = 0; i < 2; i++) {
      rn += 1;
      await addRecon({ txn_date: iso(addDays(today, -i - 4)), amount: range(8000, 25000, rng), mode: "NACH", reference: "NACHB" + String(300000 + Math.floor(rng() * 699999)), account_suffix: "5544", payer_name: "BOUNCE", status: "failed", match_type: "none" });
    }
    const revPay = reconPayments[12];
    await addRecon({ txn_date: iso(addDays(today, -6)), amount: revPay.amount, mode: "NEFT", reference: "REV-" + (revPay.reference || revPay.receipt_no), account_suffix: "3344", payer_name: "CUSTOMER REVERSAL", status: "reversed", match_type: "manual", payment_id: revPay.id, confidence: 1 });

    /* --- audit trail (~600 events) --- */
    const auditActions: [string, string][] = [
      ["auth.login", "auth"], ["kyc.pan", "kyc"], ["credit.fetch", "bureau"], ["bre.evaluate", "application"],
      ["application.approve", "application"], ["kfs.generate", "kfs"], ["agreement.sign_sandbox", "agreement"],
      ["loan.disburse", "loan"], ["payment.record", "payment"], ["collections.ptp_create", "ptp"], ["loan.restructure", "loan"]
    ];
    for (let i = 0; i < 600; i++) {
      const [action, entity] = pick(rng, auditActions);
      const userId = pick(rng, userIds);
      await run("INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, before, after, ip, device, created_at) VALUES (?, ?, ?, ?, ?, '{}', ?, '127.0.0.1', 'demo-seed', datetime('now', ?))",
        [tenantId, userId, action, entity, Math.floor(1 + rng() * 500), JSON.stringify({ demo: true }), `-${range(0, 60, rng)} days`]);
    }

    /* --- AI history --- */
    await run("INSERT INTO ai_recommendations (tenant_id, user_id, kind, prompt, result) VALUES (?, ?, 'query', 'What needs my attention today?', ?)", [tenantId, userIds[0], JSON.stringify({ intent: "attention", headline: "Demo AI — ready", items: [] })]);

    /* --- Growth Nations distribution layer --- */
    await seedGrowthNations(tenantId, rng, customerRows, userIds);

    console.log(`[NEXUS SEED] done in ${((Date.now() - started) / 1000).toFixed(1)}s — tenant=${tenantId} customers=${customerRows.length} leads=1500 applications=${appSeqState.n} loans=${loanIds.length} installments=${installmentCount} payments=${paymentCount} collection_activities=${collectionCount} branches=30 users=${userIds.length} products=${productIds.length}`);
  });
}

export async function seedIfEmpty() {
  const any = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM customers");
  if (any && any.n > 0) return;
  await seed();
}

/* CLI entry: `npm run seed` (with `reset` to wipe and reseed). Importing this
   module is harmless — seeding is guarded by the emptiness check. */
const argv = process.argv.slice(2);
if (argv.includes("reset")) {
  console.log("[NEXUS SEED] resetting database…");
  await resetSchema();
  await seed();
} else {
  await createSchema();
  seedIfEmpty();
}
