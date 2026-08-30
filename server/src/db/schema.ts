import { db } from "./connection.js";

/**
 * SNIPER schema — the platform's own domain model.
 * Tenancy-isolated: every business table carries tenant_id and is queried
 * through tenant-scoped helpers. No cross-tenant leakage by construction.
 */
export async function createSchema() {
  await db().exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    branding TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    city TEXT, state TEXT, pincode TEXT,
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    branch_id INTEGER REFERENCES branches(id),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    customer_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    branch_id INTEGER REFERENCES branches(id),
    lead_no TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    name TEXT NOT NULL,
    mobile TEXT, email TEXT,
    city TEXT, state TEXT,
    loan_type TEXT,
    requested_amount INTEGER,
    monthly_income INTEGER,
    business_turnover INTEGER,
    source TEXT,
    campaign TEXT,
    dsa_id INTEGER REFERENCES users(id),
    owner_id INTEGER REFERENCES users(id),
    score INTEGER NOT NULL DEFAULT 0,
    probability INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    next_action TEXT,
    followup_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS lead_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    user_id INTEGER REFERENCES users(id),
    kind TEXT,
    outcome TEXT,
    note TEXT,
    duration_sec INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    customer_no TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    mobile TEXT, email TEXT,
    dob TEXT, gender TEXT,
    pan TEXT,
    aadhaar_masked TEXT,
    address_line1 TEXT, city TEXT, state TEXT, pincode TEXT,
    employment_type TEXT,
    business_name TEXT,
    annual_income INTEGER,
    monthly_income INTEGER,
    business_turnover INTEGER,
    risk_class TEXT NOT NULL DEFAULT 'standard',
    credit_score INTEGER,
    kyc_status TEXT NOT NULL DEFAULT 'pending',
    status TEXT NOT NULL DEFAULT 'active',
    fraud_flag INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    min_amount INTEGER NOT NULL DEFAULT 10000,
    max_amount INTEGER NOT NULL DEFAULT 5000000,
    min_tenure INTEGER NOT NULL DEFAULT 6,
    max_tenure INTEGER NOT NULL DEFAULT 60,
    interest_type TEXT NOT NULL DEFAULT 'reducing',
    interest_rate REAL NOT NULL DEFAULT 16,
    processing_fee_pct REAL NOT NULL DEFAULT 2,
    processing_fee_gst_pct REAL NOT NULL DEFAULT 18,
    penal_rate_pct REAL NOT NULL DEFAULT 24,
    late_fee_amount INTEGER NOT NULL DEFAULT 0,
    grace_days INTEGER NOT NULL DEFAULT 3,
    prepayment_allowed INTEGER NOT NULL DEFAULT 1,
    foreclosure_charge_pct REAL NOT NULL DEFAULT 3,
    part_payment_allowed INTEGER NOT NULL DEFAULT 1,
    part_payment_min_amount INTEGER NOT NULL DEFAULT 10000,
    emi_frequency TEXT NOT NULL DEFAULT 'monthly',
    allocation_order TEXT NOT NULL DEFAULT 'penalty,fees,interest,principal',
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    application_no TEXT UNIQUE NOT NULL,
    lead_id INTEGER,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    branch_id INTEGER,
    dsa_id INTEGER,
    sales_officer_id INTEGER,
    credit_officer_id INTEGER,
    source TEXT,
    requested_amount INTEGER,
    approved_amount INTEGER,
    tenure INTEGER,
    purpose TEXT,
    co_applicant_name TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    stage TEXT NOT NULL DEFAULT 'application',
    risk_grade TEXT,
    bre_result TEXT NOT NULL DEFAULT 'pending',
    bre_detail TEXT DEFAULT '{}',
    fraud_score INTEGER,
    decision TEXT NOT NULL DEFAULT 'pending',
    decision_by INTEGER,
    decision_at TEXT,
    decision_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    rate REAL,
    offer_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS workflow_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    product_id INTEGER,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    seq INTEGER NOT NULL,
    required_fields TEXT NOT NULL DEFAULT '[]',
    required_documents TEXT NOT NULL DEFAULT '[]',
    sla_hours INTEGER NOT NULL DEFAULT 24,
    approver_role TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS application_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id),
    stage TEXT NOT NULL,
    entered_at TEXT,
    exited_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    completed_by INTEGER,
    data TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    customer_id INTEGER,
    application_id INTEGER,
    category TEXT NOT NULL,
    name TEXT,
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded',
    verified_by INTEGER,
    verified_at TEXT,
    ocr_data TEXT NOT NULL DEFAULT '{}',
    ocr_confidence REAL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS kyc_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    type TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT,
    reference_id TEXT,
    result TEXT NOT NULL DEFAULT '{}',
    consent_id INTEGER,
    verified_by INTEGER,
    verified_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    type TEXT NOT NULL,
    purpose TEXT,
    version TEXT,
    channel TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    obtained_at TEXT NOT NULL DEFAULT (datetime('now')),
    ip TEXT, device TEXT,
    withdrawn_at TEXT
  );

  CREATE TABLE IF NOT EXISTS bureau_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    provider TEXT NOT NULL DEFAULT 'MOCK-CIBIL',
    score INTEGER,
    score_band TEXT,
    total_accounts INTEGER,
    active_accounts INTEGER,
    closed_accounts INTEGER,
    overdue_accounts INTEGER,
    total_outstanding INTEGER,
    credit_utilization REAL,
    enquiries_6m INTEGER,
    writeoffs INTEGER,
    settlements INTEGER,
    dpd_max INTEGER,
    repayment_history TEXT NOT NULL DEFAULT '{}',
    data TEXT NOT NULL DEFAULT '{}',
    is_mock INTEGER NOT NULL DEFAULT 1,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bank_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    application_id INTEGER,
    provider TEXT NOT NULL DEFAULT 'MOCK-BANK',
    monthly_income INTEGER,
    monthly_expense INTEGER,
    avg_balance INTEGER,
    emi_obligations INTEGER,
    banking_surplus INTEGER,
    bounce_count INTEGER,
    cash_deposits INTEGER,
    turnover INTEGER,
    months_analyzed INTEGER NOT NULL DEFAULT 6,
    risk TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gst_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    gstin TEXT,
    turnover INTEGER,
    filing_status TEXT,
    filing_frequency TEXT,
    tax_liability INTEGER,
    declared_vs_banking_pct REAL,
    risk TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    is_mock INTEGER NOT NULL DEFAULT 1,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bre_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    code TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'credit_policy',
    version INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 100,
    conditions TEXT NOT NULL,
    action TEXT NOT NULL,
    effective_from TEXT,
    expiry TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    approved_by INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bre_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    rule_id INTEGER,
    rule_version INTEGER,
    passed INTEGER,
    result TEXT NOT NULL DEFAULT '{}',
    evaluated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT,
    level INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    by_user INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sanctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    sanction_no TEXT UNIQUE,
    amount INTEGER,
    tenure INTEGER,
    rate REAL,
    emi INTEGER,
    fees_json TEXT NOT NULL DEFAULT '{}',
    conditions TEXT NOT NULL DEFAULT '[]',
    validity_days INTEGER NOT NULL DEFAULT 90,
    status TEXT NOT NULL DEFAULT 'draft',
    issued_at TEXT,
    accepted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS kfs_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER,
    loan_id INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    content TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'generated',
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    disclosed_at TEXT,
    acknowledged_at TEXT
  );

  CREATE TABLE IF NOT EXISTS agreements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER,
    loan_id INTEGER,
    template TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    signed_at TEXT,
    signer_name TEXT,
    hash TEXT,
    provider TEXT NOT NULL DEFAULT 'SANDBOX-ESIGN'
  );

  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    loan_no TEXT UNIQUE NOT NULL,
    application_id INTEGER,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    branch_id INTEGER,
    principal INTEGER NOT NULL,
    rate REAL NOT NULL,
    tenure INTEGER NOT NULL,
    emi INTEGER,
    disbursed_at TEXT NOT NULL DEFAULT (datetime('now')),
    first_emi_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    outstanding INTEGER,
    accrued_interest INTEGER NOT NULL DEFAULT 0,
    fees_due INTEGER NOT NULL DEFAULT 0,
    penal_due INTEGER NOT NULL DEFAULT 0,
    dpd INTEGER NOT NULL DEFAULT 0,
    npa_class TEXT,
    risk_grade TEXT,
    restructured INTEGER NOT NULL DEFAULT 0,
    written_off INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS installments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    seq INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    principal INTEGER NOT NULL DEFAULT 0,
    interest INTEGER NOT NULL DEFAULT 0,
    fees INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0,
    paid_amount INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    days_late INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    superseded INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    receipt_no TEXT UNIQUE,
    amount INTEGER NOT NULL,
    mode TEXT,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    reversed INTEGER NOT NULL DEFAULT 0,
    reversal_reason TEXT,
    allocated INTEGER NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    recorded_by INTEGER
  );

  CREATE TABLE IF NOT EXISTS payment_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL REFERENCES payments(id),
    installment_id INTEGER,
    component TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ptps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    customer_id INTEGER NOT NULL,
    amount INTEGER,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'promised',
    agent_id INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    customer_id INTEGER NOT NULL,
    agent_id INTEGER,
    priority TEXT,
    kind TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    note TEXT,
    due_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS charge_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    kind TEXT,
    amount INTEGER,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'applied',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    requested_amount INTEGER,
    offered_amount INTEGER,
    status TEXT NOT NULL DEFAULT 'requested',
    approved_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS writeoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    amount INTEGER,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'requested',
    approved_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS compliance_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    rule_id TEXT,
    name TEXT NOT NULL,
    source TEXT,
    effective_from TEXT,
    expiry TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    applicable_entity TEXT,
    applicable_product TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    customer_id INTEGER,
    complaint_no TEXT UNIQUE,
    category TEXT,
    priority TEXT,
    assigned_to INTEGER,
    sla_hours INTEGER NOT NULL DEFAULT 48,
    status TEXT NOT NULL DEFAULT 'open',
    subject TEXT,
    description TEXT,
    resolution TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT,
    UNIQUE(tenant_id, key)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    before TEXT,
    after TEXT,
    ip TEXT,
    device TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    user_id INTEGER,
    kind TEXT NOT NULL DEFAULT 'inapp',
    title TEXT,
    body TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    provider TEXT,
    status TEXT NOT NULL DEFAULT 'sandbox',
    config TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS ai_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    user_id INTEGER,
    kind TEXT,
    prompt TEXT,
    context TEXT,
    result TEXT,
    human_action TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- LOS expansion: parties (co-applicant / guarantor / joint), collateral, offers, credit memos, policy exceptions
  CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    application_id INTEGER NOT NULL REFERENCES applications(id),
    type TEXT NOT NULL,               -- co_applicant | guarantor | joint
    name TEXT NOT NULL,
    pan TEXT, dob TEXT, mobile TEXT, email TEXT,
    relationship TEXT,
    employment_type TEXT,
    monthly_income INTEGER,
    credit_score INTEGER,
    consent INTEGER NOT NULL DEFAULT 0,
    documents TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collaterals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    application_id INTEGER NOT NULL REFERENCES applications(id),
    asset_type TEXT NOT NULL,
    owner_name TEXT,
    value INTEGER,
    valuation INTEGER,
    valuation_date TEXT,
    location TEXT,
    legal_status TEXT,
    encumbrance TEXT,
    insurance INTEGER NOT NULL DEFAULT 0,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    documents TEXT NOT NULL DEFAULT '[]',
    ltv REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    application_id INTEGER NOT NULL REFERENCES applications(id),
    label TEXT NOT NULL,
    amount INTEGER NOT NULL,
    tenure INTEGER NOT NULL,
    rate REAL NOT NULL,
    emi INTEGER NOT NULL,
    apr REAL NOT NULL,
    fees INTEGER NOT NULL DEFAULT 0,
    total_repayment INTEGER NOT NULL DEFAULT 0,
    risk_grade TEXT,
    conditions TEXT NOT NULL DEFAULT '[]',
    selected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS credit_memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    application_id INTEGER NOT NULL REFERENCES applications(id),
    memo_no TEXT UNIQUE,
    content TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',          -- draft | submitted | reviewed | approved | rejected | send_back
    created_by INTEGER,
    decided_by INTEGER,
    decided_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS policy_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    application_id INTEGER NOT NULL REFERENCES applications(id),
    rule_code TEXT,
    rule_name TEXT NOT NULL,
    reason TEXT,
    impact TEXT,
    risk TEXT,
    approver_required INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | rejected
    created_by INTEGER,
    decided_by INTEGER,
    decided_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Payment reconciliation
  CREATE TABLE IF NOT EXISTS recon_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    batch_no TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL,
    total_transactions INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'imported',
    imported_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recon_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    batch_id INTEGER NOT NULL REFERENCES recon_batches(id),
    txn_date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    mode TEXT,
    reference TEXT,
    account_suffix TEXT,
    payer_name TEXT,
    status TEXT NOT NULL DEFAULT 'unmatched',      -- matched | unmatched | duplicate | failed | reversed | requires_review
    match_type TEXT,                              -- auto_reference | auto_amount | manual | none
    payment_id INTEGER,
    loan_id INTEGER,
    customer_id INTEGER,
    confidence REAL,
    note TEXT,
    reconciled_at TEXT,
    reversed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- LMS expansion: loan events (append-only financial ledger) + closure records
  CREATE TABLE IF NOT EXISTS loan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    kind TEXT NOT NULL,                           -- disbursement | payment | reversal | restructure | closure | settlement | writeoff | recovery | charge
    amount INTEGER,
    reference TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    loan_id INTEGER NOT NULL REFERENCES loans(id),
    statement TEXT,
    noc TEXT,
    status TEXT NOT NULL DEFAULT 'requested',     -- requested | approved | closed
    approved_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_apps_tenant ON applications(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_apps_stage ON applications(stage);
  CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_loans_tenant ON loans(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_loans_dpd ON loans(dpd);
  CREATE INDEX IF NOT EXISTS idx_inst_loan ON installments(loan_id, seq);
  CREATE INDEX IF NOT EXISTS idx_pay_loan ON payments(loan_id);
  CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_recon_tenant ON recon_transactions(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_recon_status ON recon_transactions(status);
  CREATE INDEX IF NOT EXISTS idx_loan_events ON loan_events(loan_id);

  -- ============ GROWTH NATIONS — Loan Distribution OS ============
  -- Lender network, schemes & payout masters
  CREATE TABLE IF NOT EXISTS gn_lenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Bank',            -- Bank | NBFC | HFC | Fintech
    dsa_code TEXT,
    contact_person TEXT, contact_phone TEXT, contact_email TEXT,
    gst_policy TEXT NOT NULL DEFAULT 'client',    -- client | own | split
    api_status TEXT NOT NULL DEFAULT 'mock',      -- mock | sandbox | production | none
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    lender_id INTEGER REFERENCES gn_lenders(id),
    category TEXT NOT NULL,                       -- Business Loan | Home Loan | Personal Loan | Auto Loan | CV | Equipment | LAP | MSME ...
    name TEXT NOT NULL,
    vertical TEXT NOT NULL DEFAULT 'fi',
    min_amount INTEGER NOT NULL DEFAULT 100000,
    max_amount INTEGER NOT NULL DEFAULT 50000000,
    min_tenure INTEGER NOT NULL DEFAULT 12,
    max_tenure INTEGER NOT NULL DEFAULT 120,
    roi_min REAL, roi_max REAL,
    processing_fee_pct REAL DEFAULT 0,
    payout_pct REAL DEFAULT 0,                    -- commission % of disbursement for this product
    min_turnover INTEGER, min_vintage INTEGER, min_income INTEGER,
    geography TEXT NOT NULL DEFAULT '[]',
    required_documents TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS gn_schemes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    lender_id INTEGER REFERENCES gn_lenders(id),
    product_id INTEGER REFERENCES gn_products(id),
    name TEXT NOT NULL,
    payout_type TEXT NOT NULL DEFAULT 'percent',  -- percent | flat | slab
    rate REAL DEFAULT 0,
    flat_amount INTEGER DEFAULT 0,
    slabs TEXT NOT NULL DEFAULT '[]',             -- [{min,max,rate}]
    effective_from TEXT, effective_to TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    profile TEXT,                                -- target customer profile: Salaried | Self-Employed | Business | Both
    states TEXT NOT NULL DEFAULT '[]',
    loan_params TEXT NOT NULL DEFAULT '{}',      -- {min_amount,max_amount,min_tenure,max_tenure,roi_min,roi_max,processing_fee_pct,processing_fee_max,insurance_pct,other_fees,property_area_min,property_area_max,bank_tat,rate_notes,rate_salaried,rate_senp,processing_fee_flat,processing_fee_notes}
    eligibility TEXT NOT NULL DEFAULT '{}',      -- {min_age,max_age,min_income,min_turnover,min_vintage,max_foir,max_ltv,min_credit_score,geo_radius_km,property_types,max_exposure,max_enquiries_6m,bt_allowed,bt_notes,city_tiers,applicant_types}
    programs TEXT NOT NULL DEFAULT '[]',         -- [BT, LRD, Top-up, Surrogate, ...]
    purposes TEXT NOT NULL DEFAULT '[]',
    usp TEXT,
    commission_pct REAL DEFAULT 0,
    policy TEXT NOT NULL DEFAULT '{}',           -- {negative_list, cibil_required, notes, checks, city_specific, variants, profile_categories}
    source TEXT NOT NULL DEFAULT 'manual',       -- manual | feed | import
    notes TEXT,
    banker_name TEXT, banker_email TEXT, banker_phone TEXT, branch TEXT, sub_product TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Scheme circulars / imported scheme documents (PDF, images, Excel files) stored per tenant
  CREATE TABLE IF NOT EXISTS gn_scheme_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    scheme_id INTEGER REFERENCES gn_schemes(id),
    kind TEXT NOT NULL DEFAULT 'circular',        -- circular | scheme_document | import_source
    filename TEXT NOT NULL,
    mime TEXT,
    size INTEGER DEFAULT 0,
    content TEXT,                                -- base64 payload for demo storage
    extracted TEXT,                              -- best-effort extracted text (if any)
    status TEXT NOT NULL DEFAULT 'stored',       -- stored | pending_review | parsed
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Configurable roles & permissions (admin-toggled, DB-backed overrides of built-in ROLES)
  CREATE TABLE IF NOT EXISTS gn_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'staff',          -- staff | partner
    designation TEXT,
    partner_type TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, code)
  );

  CREATE TABLE IF NOT EXISTS gn_role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    role_id INTEGER NOT NULL REFERENCES gn_roles(id),
    module TEXT NOT NULL,
    action TEXT NOT NULL,                        -- view | create | edit | delete | manage | use
    scope TEXT NOT NULL DEFAULT 'all',           -- all | own
    allowed INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, role_id, module, action)
  );

  -- DSA / partner network
  CREATE TABLE IF NOT EXISTS gn_parent_dsas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    code TEXT,
    bank_codes TEXT NOT NULL DEFAULT '[]',
    contact TEXT,
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS gn_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'DSA',             -- Master DSA | DSA | Sub-DSA | Sales Agent | Connector | Dealer | Builder
    phone TEXT, email TEXT, pan TEXT, gstin TEXT,
    commission_pct REAL NOT NULL DEFAULT 0,
    parent_id INTEGER REFERENCES gn_partners(id),
    user_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_dsa_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    lender_id INTEGER REFERENCES gn_lenders(id),
    parent_dsa_id INTEGER REFERENCES gn_parent_dsas(id),
    code TEXT NOT NULL,
    label TEXT,
    product_id INTEGER REFERENCES gn_products(id),
    via_parent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS gn_bankers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    bank TEXT, branch TEXT, city TEXT,
    role TEXT,
    phone TEXT, email TEXT,
    status TEXT NOT NULL DEFAULT 'active'
  );

  -- Distribution pipeline: applications routed to lenders
  CREATE TABLE IF NOT EXISTS gn_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    ref TEXT UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    name TEXT NOT NULL,
    mobile TEXT, email TEXT,
    city TEXT, state TEXT,
    employment_type TEXT,
    monthly_income INTEGER, business_turnover INTEGER, business_vintage INTEGER,
    loan_type TEXT,
    product_id INTEGER REFERENCES gn_products(id),
    lender_id INTEGER REFERENCES gn_lenders(id),
    scheme_id INTEGER REFERENCES gn_schemes(id),
    dsa_code TEXT,
    partner_id INTEGER REFERENCES gn_partners(id),
    assigned_to INTEGER REFERENCES users(id),
    amount INTEGER NOT NULL,
    tenure INTEGER NOT NULL DEFAULT 12,
    purpose TEXT,
    status TEXT NOT NULL DEFAULT 'app_created',
    stage TEXT NOT NULL DEFAULT 'application',    -- lead | application | lender | agreement | disbursement | completed | closed
    source TEXT NOT NULL DEFAULT 'dsa',
    submitted_at TEXT, sanctioned_at TEXT, disbursed_at TEXT,
    disbursed_amount INTEGER DEFAULT 0,
    commission_rate REAL DEFAULT 0,
    commission_gross INTEGER DEFAULT 0,
    commission_tds INTEGER DEFAULT 0,
    commission_net INTEGER DEFAULT 0,
    fees_collected INTEGER DEFAULT 0,
    rejected_reason TEXT,
    notes TEXT,
    is_direct_booking INTEGER NOT NULL DEFAULT 0,
    is_cross_sell INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    applicant_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS gn_application_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    app_id INTEGER NOT NULL REFERENCES gn_applications(id),
    event TEXT NOT NULL,
    note TEXT,
    actor INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Finance: commissions, receivables, payouts, fees, expenses
  CREATE TABLE IF NOT EXISTS gn_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    app_id INTEGER NOT NULL REFERENCES gn_applications(id),
    lender_id INTEGER REFERENCES gn_lenders(id),
    scheme_id INTEGER REFERENCES gn_schemes(id),
    disbursed_amount INTEGER NOT NULL,
    rate REAL NOT NULL,
    gross INTEGER NOT NULL,
    gst INTEGER NOT NULL DEFAULT 0,
    tds INTEGER NOT NULL DEFAULT 0,
    net INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'earned',        -- earned | received
    received_at TEXT,
    utr TEXT,
    invoice_no TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_payout_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    batch_ref TEXT UNIQUE NOT NULL,
    payee_type TEXT NOT NULL,                     -- Partner | Employee
    payee_id INTEGER,
    payee_name TEXT NOT NULL,
    loans TEXT NOT NULL DEFAULT '[]',
    gross INTEGER NOT NULL DEFAULT 0,
    tds INTEGER NOT NULL DEFAULT 0,
    net INTEGER NOT NULL DEFAULT 0,
    splits TEXT NOT NULL DEFAULT '{}',            -- {builder:60, gn:40}
    status TEXT NOT NULL DEFAULT 'draft',         -- draft | approved | paid
    mode TEXT, utr TEXT,
    paid_at TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_customer_fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    app_id INTEGER NOT NULL REFERENCES gn_applications(id),
    processing INTEGER DEFAULT 0,
    insurance INTEGER DEFAULT 0,
    rto INTEGER DEFAULT 0,
    other INTEGER DEFAULT 0,
    disbursed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS gn_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'operations',
    vendor TEXT,
    amount INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    claim_type TEXT NOT NULL DEFAULT 'expense',  -- expense | conveyance
    status TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected | paid
    claimed_by INTEGER,
    decided_by INTEGER,
    decided_at TEXT,
    expense_date TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- HR + Marketing + documents
  CREATE TABLE IF NOT EXISTS gn_leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    leave_type TEXT NOT NULL DEFAULT 'casual',
    from_date TEXT NOT NULL, to_date TEXT NOT NULL,
    days REAL NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
    decided_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    check_in TEXT, check_out TEXT,
    status TEXT NOT NULL DEFAULT 'present',
    UNIQUE(user_id, date)
  );

  CREATE TABLE IF NOT EXISTS gn_payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    month TEXT NOT NULL,
    basic INTEGER, hra INTEGER, allowance INTEGER,
    gross INTEGER, tds INTEGER, net INTEGER,
    status TEXT NOT NULL DEFAULT 'generated',
    UNIQUE(user_id, month)
  );

  CREATE TABLE IF NOT EXISTS gn_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    position TEXT, phone TEXT, email TEXT,
    source TEXT, stage TEXT NOT NULL DEFAULT 'applied',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'meta',
    spend INTEGER NOT NULL DEFAULT 0,
    leads INTEGER NOT NULL DEFAULT 0,
    applications INTEGER NOT NULL DEFAULT 0,
    disbursed_amount INTEGER NOT NULL DEFAULT 0,
    start_date TEXT, end_date TEXT,
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS gn_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    entity_type TEXT NOT NULL,                   -- customer | application | partner | payout
    entity_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',       -- pending | uploaded | under_review | verified | rejected | replacement | expired | not_required
    uploaded_by INTEGER,
    verified_by INTEGER,
    verified_at TEXT,
    expiry TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    title TEXT NOT NULL,
    linked_to TEXT,              -- lead / application ref
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | in_progress | completed
    due_at TEXT,
    assigned_to INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ============ Growth Nations — Marketing Automation / Inbox / Help ============

  CREATE TABLE IF NOT EXISTS gn_workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'lead_captured',   -- lead_captured | app_created | milestone_reached | manual
    trigger_detail TEXT,
    route TEXT NOT NULL DEFAULT 'score_round_robin', -- score_round_robin | round_robin | manual | specific_pool
    actions TEXT NOT NULL DEFAULT '[]',              -- JSON: [{type:'whatsapp'|'task'|'email'|'ivr', template_id?, title?, days_offset?}]
    status TEXT NOT NULL DEFAULT 'draft',            -- draft | active | paused
    run_count INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_ivr_menus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    greeting TEXT,
    menu_options TEXT NOT NULL DEFAULT '[]',        -- JSON: [{key:'1', label:'Sales', route:'telecalling'}]
    fallback TEXT NOT NULL DEFAULT 'Telecalling',
    status TEXT NOT NULL DEFAULT 'active',
    call_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    call_id TEXT UNIQUE NOT NULL,                    -- e.g. IVR-2026-000123
    caller TEXT,                                     -- masked mobile
    ivr_menu_id INTEGER,
    route TEXT,                                      -- telecalling | sales | collections | support
    outcome TEXT NOT NULL DEFAULT 'connected',       -- connected | no_answer | busy | invalid_option | callback
    duration_sec INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_message_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'whatsapp',       -- whatsapp | sms | email
    purpose TEXT NOT NULL DEFAULT 'promotional',     -- promotional | transactional | collection | onboarding
    body TEXT NOT NULL,
    variables TEXT NOT NULL DEFAULT '[]',            -- JSON list of {{var}} placeholders
    status TEXT NOT NULL DEFAULT 'approved',         -- draft | approved | rejected
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_whatsapp_drips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'lead_captured',   -- lead_captured | post_disbursement | missed_emi | inquiry
    audience TEXT NOT NULL DEFAULT 'all_leads',      -- all_leads | no_application | disb_only | overdue
    template_id INTEGER,
    schedule TEXT NOT NULL DEFAULT 'immediate',      -- immediate | daily | custom
    custom_hour INTEGER,
    status TEXT NOT NULL DEFAULT 'active',           -- active | paused | completed
    sent_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_inbox_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    direction TEXT NOT NULL DEFAULT 'in',            -- in | out
    channel TEXT NOT NULL DEFAULT 'whatsapp',        -- whatsapp | sms | email | call
    from_contact TEXT,
    to_contact TEXT,
    subject TEXT,
    body TEXT NOT NULL,
    related_type TEXT,                               -- lead | application | customer | campaign
    related_id INTEGER,
    status TEXT NOT NULL DEFAULT 'unread',           -- unread | read | replied | sent | failed
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    title TEXT NOT NULL,
    slug TEXT,
    category TEXT NOT NULL DEFAULT 'Getting Started',
    content TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_faqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    helpful_yes INTEGER NOT NULL DEFAULT 0,
    helpful_no INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',         -- low | medium | high | urgent
    status TEXT NOT NULL DEFAULT 'open',             -- open | in_progress | resolved | closed
    category TEXT NOT NULL DEFAULT 'Bug',
    created_by INTEGER,
    assigned_to INTEGER,
    resolution TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS gn_changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'feature',        -- feature | fix | improvement | security
    released_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_trash (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    entity_type TEXT NOT NULL,                       -- campaign | task | document | scheme | doc | template | workflow | ivr_menu | drip | faq | changelog
    entity_id INTEGER NOT NULL,
    name TEXT,
    payload TEXT NOT NULL,                           -- full JSON row so it can be restored exactly
    deleted_by INTEGER,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
    restored_at TEXT
  );

  -- ============ Growth Nations Command Center — Loan Origination ============

  CREATE TABLE IF NOT EXISTS gn_applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    ref TEXT UNIQUE NOT NULL,                  -- GN-APL-2026-000001
    name TEXT NOT NULL,
    mobile TEXT, email TEXT, pan TEXT, dob TEXT, gender TEXT,
    city TEXT, state TEXT, pincode TEXT,
    applicant_type TEXT NOT NULL DEFAULT 'Individual',   -- Individual | Company | Partnership | Proprietorship
    employment_type TEXT,                                 -- Salaried | Self-employed | Business Owner
    employer TEXT, designation TEXT, years_employed INTEGER,
    business_name TEXT, business_type TEXT, business_vintage INTEGER, industry TEXT, employees INTEGER,
    monthly_income INTEGER, annual_income INTEGER, annual_turnover INTEGER, net_profit INTEGER,
    gst TEXT, udyam TEXT,
    existing_emi INTEGER NOT NULL DEFAULT 0, existing_loans INTEGER NOT NULL DEFAULT 0,
    bank_name TEXT, bank_account TEXT, ifsc TEXT,
    otp_status TEXT NOT NULL DEFAULT 'not_sent',   -- not_sent | sent | verified
    consent_status TEXT NOT NULL DEFAULT 'not_required', -- not_required | required | sent | received | expired | rejected
    kyc_status TEXT NOT NULL DEFAULT 'not_started',      -- not_started | consent_required | pending | processing | completed | failed | manual_review
    credit_status TEXT NOT NULL DEFAULT 'not_requested', -- not_requested | consent_required | requested | processing | completed | failed | manual_review
    match_status TEXT NOT NULL DEFAULT 'not_run',        -- not_run | running | completed | no_match
    doc_status TEXT NOT NULL DEFAULT 'pending',          -- pending | in_progress | completed
    app_status TEXT NOT NULL DEFAULT 'none',             -- none | created | submitted | uw | approved | rejected | sanctioned | agreement | disb_initiated | disbursed | payout
    loan_type TEXT, loan_amount INTEGER, tenure INTEGER, purpose TEXT,
    collateral TEXT, property_type TEXT,
    credit_score INTEGER,
    source TEXT NOT NULL DEFAULT 'manual', campaign TEXT, builder TEXT, oem TEXT, dsa_code TEXT,
    partner_id INTEGER REFERENCES gn_partners(id),
    assigned_to INTEGER REFERENCES users(id),
    batch_id INTEGER,
    is_demo INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gn_applicants_tenant ON gn_applicants(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_gn_applicants_mobile ON gn_applicants(tenant_id, mobile);
  CREATE INDEX IF NOT EXISTS idx_gn_applicants_status ON gn_applicants(app_status);

  CREATE TABLE IF NOT EXISTS gn_applicant_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    event TEXT NOT NULL,
    note TEXT,
    actor INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_gn_apl_events ON gn_applicant_events(applicant_id);

  CREATE TABLE IF NOT EXISTS gn_consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    purpose TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'required',   -- required | sent | received | expired | rejected
    version TEXT, source TEXT,
    received_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_kyc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    kyc_type TEXT NOT NULL,                   -- mobile | pan | identity | address | bank
    provider TEXT NOT NULL DEFAULT 'Demo KYC Provider',
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | processing | verified | failed | manual_review
    reference TEXT,
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_credit_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    provider TEXT NOT NULL DEFAULT 'Demo Credit Provider',
    score INTEGER NOT NULL,
    active_accounts INTEGER DEFAULT 0,
    closed_accounts INTEGER DEFAULT 0,
    enquiries_6m INTEGER DEFAULT 0,
    total_outstanding INTEGER DEFAULT 0,
    total_sanctioned INTEGER DEFAULT 0,
    overdue_amount INTEGER DEFAULT 0,
    dpd INTEGER DEFAULT 0,
    utilization_pct REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    reference TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_lender_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    lender_id INTEGER REFERENCES gn_lenders(id),
    product_id INTEGER REFERENCES gn_products(id),
    scheme_id INTEGER REFERENCES gn_schemes(id),
    lender_name TEXT, product_name TEXT, scheme_name TEXT,
    category TEXT,
    min_amount INTEGER, max_amount INTEGER, roi TEXT, tenure TEXT,
    score INTEGER NOT NULL DEFAULT 0,          -- 0-100 Growth Nations product-match score (NOT a lender approval score)
    status TEXT NOT NULL DEFAULT 'eligible',   -- eligible | maybe | not_eligible
    selected INTEGER NOT NULL DEFAULT 0,
    reasons TEXT NOT NULL DEFAULT '[]',
    commission_pct REAL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_sanctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    app_id INTEGER REFERENCES gn_applications(id),
    lender_id INTEGER REFERENCES gn_lenders(id),
    sanctioned_amount INTEGER NOT NULL,
    tenure INTEGER, roi REAL,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'approved',   -- approved | rejected
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_agreements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    app_id INTEGER REFERENCES gn_applications(id),
    status TEXT NOT NULL DEFAULT 'pending',    -- pending | generated | esign_pending | completed | failed
    reference TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_disbursements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    app_id INTEGER REFERENCES gn_applications(id),
    lender_id INTEGER REFERENCES gn_lenders(id),
    amount INTEGER NOT NULL,
    bank_account TEXT,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'initiated',  -- initiated | completed | failed
    utr TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    applicant_id INTEGER NOT NULL REFERENCES gn_applicants(id),
    app_id INTEGER REFERENCES gn_applications(id),
    disbursed_amount INTEGER NOT NULL,
    rate REAL NOT NULL,
    gross INTEGER NOT NULL,
    gst INTEGER NOT NULL DEFAULT 0,
    tds INTEGER NOT NULL DEFAULT 0,
    net INTEGER NOT NULL DEFAULT 0,
    partner_split_pct REAL DEFAULT 60,
    partner_share INTEGER DEFAULT 0,
    gn_share INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'expected',   -- expected | received | reconciled
    received_at TEXT, utr TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ============ Bulk Application Processing Engine ============

  CREATE TABLE IF NOT EXISTS gn_bulk_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL DEFAULT 'Manual',     -- Builder | OEM | DSA | CA | Dealer | Branch | Campaign | Manual
    loan_type TEXT,
    assigned_team TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',   -- low | normal | high | urgent
    status TEXT NOT NULL DEFAULT 'draft',      -- draft | uploaded | validating | validated | processing | completed | failed | paused | cancelled
    progress REAL NOT NULL DEFAULT 0,
    total_rows INTEGER NOT NULL DEFAULT 0,
    valid INTEGER NOT NULL DEFAULT 0,
    invalid INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0,
    missing INTEGER NOT NULL DEFAULT 0,
    applicants_created INTEGER NOT NULL DEFAULT 0,
    applications_created INTEGER NOT NULL DEFAULT 0,
    submitted INTEGER NOT NULL DEFAULT 0,
    approved INTEGER NOT NULL DEFAULT 0,
    disbursed INTEGER NOT NULL DEFAULT 0,
    disbursed_amount INTEGER NOT NULL DEFAULT 0,
    expected_payout INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'assisted',     -- manual | assisted | automated
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gn_bulk_batches_tenant ON gn_bulk_batches(tenant_id);

  CREATE TABLE IF NOT EXISTS gn_bulk_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    batch_id INTEGER NOT NULL REFERENCES gn_bulk_batches(id),
    row_no INTEGER NOT NULL,
    raw TEXT NOT NULL DEFAULT '{}',
    mapped TEXT NOT NULL DEFAULT '{}',
    validation TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',    -- pending | valid | invalid | duplicate | missing | applicant_created | app_created | submitted | approved | rejected | disbursed | failed | skipped
    applicant_id INTEGER,
    application_id INTEGER,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_gn_bulk_rows_batch ON gn_bulk_rows(batch_id);
  CREATE INDEX IF NOT EXISTS idx_gn_bulk_rows_status ON gn_bulk_rows(batch_id, status);

  CREATE TABLE IF NOT EXISTS gn_bulk_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    batch_id INTEGER NOT NULL REFERENCES gn_bulk_batches(id),
    row_id INTEGER,
    applicant_id INTEGER,
    application_id INTEGER,
    job_type TEXT NOT NULL,                   -- validate | otp | consent | kyc | credit | match | application | submit | underwrite | approve | agreement | disburse | payout
    status TEXT NOT NULL DEFAULT 'queued',     -- queued | processing | completed | failed | retrying | cancelled | paused | skipped
    priority TEXT NOT NULL DEFAULT 'normal',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    provider TEXT,
    request_id TEXT,
    started_at TEXT, completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_gn_bulk_jobs_batch ON gn_bulk_jobs(batch_id, job_type);

  CREATE TABLE IF NOT EXISTS gn_bulk_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    batch_id INTEGER NOT NULL REFERENCES gn_bulk_batches(id),
    row_id INTEGER,
    category TEXT NOT NULL,                   -- invalid_data | duplicate | consent_missing | kyc_failed | credit_unavailable | document_missing | product_mismatch | lender_api | timeout | rate_limit | auth | webhook | rejection | disbursement | payout
    message TEXT NOT NULL,
    recommendation TEXT,
    status TEXT NOT NULL DEFAULT 'open',      -- open | resolved | ignored
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ============ API Integration Center ============

  CREATE TABLE IF NOT EXISTS gn_api_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    category TEXT NOT NULL,                   -- otp | kyc | pan | credit | gst | udyam | bank | esign | lender | disbursement | document | sms | whatsapp | email
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sandbox_ready', -- demo_connected | sandbox_ready | not_connected
    env TEXT NOT NULL DEFAULT 'demo',         -- demo | sandbox | production
    endpoint TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_tested_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gn_api_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    provider TEXT, category TEXT,
    action TEXT NOT NULL,
    endpoint TEXT,
    status TEXT NOT NULL DEFAULT 'success',   -- success | failed | retrying
    request_id TEXT,
    latency_ms INTEGER,
    response TEXT,
    error TEXT,
    environment TEXT DEFAULT 'demo',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_gn_api_logs_tenant ON gn_api_logs(tenant_id);

  CREATE TABLE IF NOT EXISTS gn_webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    provider TEXT NOT NULL,
    event TEXT NOT NULL,
    app_id INTEGER,
    request_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'received',  -- received | processed | failed | retrying
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gn_webhook_events_tenant ON gn_webhook_events(tenant_id);

  CREATE INDEX IF NOT EXISTS idx_gn_apps_tenant ON gn_applications(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_gn_apps_status ON gn_applications(status);
  CREATE INDEX IF NOT EXISTS idx_gn_timeline_app ON gn_application_timeline(app_id);
  CREATE INDEX IF NOT EXISTS idx_gn_commissions_tenant ON gn_commissions(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_gn_partners_tenant ON gn_partners(tenant_id);
  `);
}

export async function resetSchema() {
  const tables = [
    "gn_webhook_events", "gn_api_logs", "gn_api_providers", "gn_bulk_errors", "gn_bulk_jobs", "gn_bulk_rows", "gn_bulk_batches",
    "gn_payouts", "gn_disbursements", "gn_agreements", "gn_sanctions", "gn_lender_matches", "gn_credit_profiles", "gn_kyc", "gn_consents",
    "gn_applicant_events", "gn_applicants",
    "gn_trash", "gn_changelog", "gn_support_tickets", "gn_faqs", "gn_docs", "gn_inbox_messages", "gn_whatsapp_drips", "gn_message_templates", "gn_call_logs", "gn_ivr_menus", "gn_workflows",
    "gn_documents", "gn_campaigns", "gn_candidates", "gn_payroll", "gn_attendance", "gn_leave_requests",
    "gn_expenses", "gn_customer_fees", "gn_payout_batches", "gn_commissions", "gn_application_timeline", "gn_applications",
    "gn_bankers", "gn_dsa_codes", "gn_partners", "gn_parent_dsas", "gn_role_permissions", "gn_roles", "gn_scheme_files", "gn_schemes", "gn_products", "gn_lenders",
    "closures", "loan_events", "recon_transactions", "recon_batches", "policy_exceptions", "credit_memos",
    "offers", "collaterals", "parties", "ai_recommendations", "notifications", "audit_logs", "complaints", "compliance_rules",
    "writeoffs", "settlements", "charge_events", "collection_tasks", "ptps",
    "payment_allocations", "payments", "installments", "loans", "agreements",
    "kfs_documents", "sanctions", "approvals", "bre_evaluations", "bre_rules",
    "gst_profiles", "bank_analyses", "bureau_reports", "consents", "kyc_records", "system_config",
    "documents", "application_stages", "workflow_stages", "applications", "products",
    "customers", "lead_activities", "leads", "sessions", "users", "branches", "tenants"
  ];
  await db().exec("PRAGMA foreign_keys = OFF;");
  for (const t of tables) {
    await db().exec(`DROP TABLE IF EXISTS ${t} CASCADE;`);
  }
  await createSchema();
  await db().exec("PRAGMA foreign_keys = ON;");
}
