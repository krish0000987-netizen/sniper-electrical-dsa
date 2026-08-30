import { ApplicationRecord, UnreconciledPayment, BreRule, CollectionItem, IntegrationPartner, WhiteLabelBrand, IndustryModel } from '../types';

export const INITIAL_APPLICATIONS: ApplicationRecord[] = [
  {
    id: 'NX-10482',
    applicantName: 'Rahul Sharma',
    loanType: 'Business Loan',
    amount: 2500000,
    tenureMonths: 36,
    creditScore: 782,
    foir: 38,
    dscr: 1.85,
    kycStatus: 'VERIFIED',
    breStatus: 'PASSED',
    underwritingStatus: 'APPROVED',
    riskLevel: 'LOW',
    stage: 'Sanction & KFS Issued',
    createdAt: '2026-08-11 09:15'
  },
  {
    id: 'NX-10483',
    applicantName: 'Ananya Enterprises',
    loanType: 'MSME Working Capital',
    amount: 5000000,
    tenureMonths: 24,
    creditScore: 745,
    foir: 42,
    dscr: 1.45,
    kycStatus: 'VERIFIED',
    breStatus: 'PASSED',
    underwritingStatus: 'IN_REVIEW',
    riskLevel: 'MEDIUM',
    stage: 'Underwriting Queue',
    createdAt: '2026-08-11 09:42'
  },
  {
    id: 'NX-10484',
    applicantName: 'Vikram Mehta',
    loanType: 'Personal Loan',
    amount: 750000,
    tenureMonths: 48,
    creditScore: 810,
    foir: 29,
    dscr: 2.10,
    kycStatus: 'VERIFIED',
    breStatus: 'PASSED',
    underwritingStatus: 'APPROVED',
    riskLevel: 'LOW',
    stage: 'E-Sign Completed',
    createdAt: '2026-08-11 10:04'
  },
  {
    id: 'NX-10485',
    applicantName: 'Priya Sundaram',
    loanType: 'Loan Against Property',
    amount: 12000000,
    tenureMonths: 120,
    creditScore: 715,
    foir: 49,
    dscr: 1.22,
    kycStatus: 'VERIFIED',
    breStatus: 'REVIEW',
    underwritingStatus: 'CONDITIONAL',
    riskLevel: 'MEDIUM',
    stage: 'Policy Exception Review',
    createdAt: '2026-08-11 10:30'
  },
  {
    id: 'NX-10486',
    applicantName: 'Greenline Logistics',
    loanType: 'Vehicle Finance',
    amount: 3200000,
    tenureMonths: 60,
    creditScore: 760,
    foir: 36,
    dscr: 1.65,
    kycStatus: 'VERIFIED',
    breStatus: 'PASSED',
    underwritingStatus: 'APPROVED',
    riskLevel: 'LOW',
    stage: 'Disbursement Ready',
    createdAt: '2026-08-11 10:55'
  }
];

export const MOCK_RECONCILIATION_PAYMENTS: UnreconciledPayment[] = [
  {
    id: 'REC-901',
    utr: 'UTR9823417721',
    amount: 52400,
    channel: 'NEFT / HDFC Bank',
    date: 'Today, 08:30 AM',
    candidateLoanId: 'LN-20481',
    candidateBorrower: 'Rahul Sharma (Ananya Corp)',
    confidenceScore: 98.4,
    status: 'PENDING'
  },
  {
    id: 'REC-902',
    utr: 'UTR7710294821',
    amount: 18500,
    channel: 'eNACH Auto Debit',
    date: 'Today, 07:15 AM',
    candidateLoanId: 'LN-19822',
    candidateBorrower: 'Deepak Patel',
    confidenceScore: 99.1,
    status: 'PENDING'
  },
  {
    id: 'REC-903',
    utr: 'UPI/66192840182',
    amount: 34200,
    channel: 'Razorpay UPI Gateway',
    date: 'Today, 06:45 AM',
    candidateLoanId: 'LN-22104',
    candidateBorrower: 'Sunita Verma',
    confidenceScore: 92.0,
    status: 'PENDING'
  },
  {
    id: 'REC-904',
    utr: 'RTGS/HDFCR520260811',
    amount: 125000,
    channel: 'RTGS Direct Wire',
    date: 'Yesterday, 05:20 PM',
    candidateLoanId: 'LN-18402',
    candidateBorrower: 'Apex Retail Infra',
    confidenceScore: 89.5,
    status: 'PENDING'
  }
];

export const MOCK_BRE_RULES: BreRule[] = [
  {
    id: 'RULE-01',
    name: 'Prime Retail Credit Check',
    category: 'Eligibility',
    conditionStr: 'Credit Score >= 750 AND FOIR <= 45% AND No DPD > 30 in 12 months',
    minCreditScore: 750,
    maxFoir: 45,
    minIncome: 50000,
    maxDpdDays: 0,
    actionIfPass: 'Auto-Approve up to ₹15 Lakhs',
    status: 'ACTIVE'
  },
  {
    id: 'RULE-02',
    name: 'MSME DSCR & GST Validation',
    category: 'Commercial',
    conditionStr: 'GST Turnover >= ₹1 Cr AND DSCR >= 1.30 AND Bank Balance Trend = Positive',
    minCreditScore: 700,
    maxFoir: 55,
    minIncome: 100000,
    maxDpdDays: 30,
    actionIfPass: 'Route to Level-2 Senior Underwriter',
    status: 'ACTIVE'
  },
  {
    id: 'RULE-03',
    name: 'Fraud & Sanctions Screening',
    category: 'Compliance',
    conditionStr: 'PAN Verified AND Aadhaar Ok AND CKYC Match = 100% AND No High Risk Fraud Tag',
    minCreditScore: 650,
    maxFoir: 60,
    minIncome: 30000,
    maxDpdDays: 60,
    actionIfPass: 'Proceed to KFS Generation',
    status: 'ACTIVE'
  }
];

export const MOCK_COLLECTIONS: CollectionItem[] = [
  {
    id: 'COL-101',
    borrowerName: 'Karan Traders (Karan Kapoor)',
    loanId: 'LN-18402',
    outstandingAmount: 482000,
    emiAmount: 48200,
    dpdDays: 18,
    ptpDate: '2026-08-14',
    ptpAmount: 48200,
    bucket: '0-30 DPD',
    lastAction: 'Telecalling PTP Agreed via WhatsApp Link',
    status: 'PTP_KEPT'
  },
  {
    id: 'COL-102',
    borrowerName: 'Sanjay Deshmukh',
    loanId: 'LN-17290',
    outstandingAmount: 210000,
    emiAmount: 2100,
    dpdDays: 42,
    ptpDate: '2026-08-10',
    ptpAmount: 21000,
    bucket: '31-60 DPD',
    lastAction: 'Broken PTP - Escalated to Field Sales Agent (Ramesh K.)',
    status: 'PTP_BROKEN'
  },
  {
    id: 'COL-103',
    borrowerName: 'Lotus Logistics Solutions',
    loanId: 'LN-14022',
    outstandingAmount: 1850000,
    emiAmount: 125000,
    dpdDays: 74,
    ptpDate: '2026-08-18',
    ptpAmount: 125000,
    bucket: '61-90 DPD',
    lastAction: 'Legal Notice Drafted & Field Visit Scheduled',
    status: 'FIELD_ASSIGNED'
  }
];

export const MOCK_INTEGRATIONS: IntegrationPartner[] = [
  { id: 'int-1', name: 'CIBIL / TransUnion', category: 'Bureau', status: 'READY', description: 'Instant consumer & commercial credit score & pull reports', iconName: 'FileCheck' },
  { id: 'int-2', name: 'Experian Credit', category: 'Bureau', status: 'READY', description: 'Real-time tradeline & delinquency check', iconName: 'ShieldCheck' },
  { id: 'int-3', name: 'Setu Account Aggregator', category: 'Banking/AA', status: 'READY', description: 'Consent-based bank statement fetch & automated cashflow analytics', iconName: 'Building2' },
  { id: 'int-4', name: 'Perfios Statement Analyzer', category: 'Banking/AA', status: 'READY', description: 'Automated 12-month bank statement parsing & bounce calculation', iconName: 'LineChart' },
  { id: 'int-5', name: 'GSTN Portal API', category: 'KYC/eKYC', status: 'READY', description: 'GST 3B/1 return validation & GSTR filing verification', iconName: 'Receipt' },
  { id: 'int-6', name: 'UIDAI Aadhaar eKYC', category: 'KYC/eKYC', status: 'READY', description: 'OTP & biometric Aadhaar authentication with face match', iconName: 'UserCheck' },
  { id: 'int-7', name: 'Protean PAN & NSDL', category: 'KYC/eKYC', status: 'READY', description: 'Instant PAN name & status verification', iconName: 'CreditCard' },
  { id: 'int-8', name: 'Razorpay / Cashfree', category: 'Payments', status: 'READY', description: 'Instant loan disbursement, UPI auto-debit & gateway collection', iconName: 'ArrowRightLeft' },
  { id: 'int-9', name: 'eNACH / NPCI Mandate', category: 'Payments', status: 'READY', description: 'Automated recurring EMI debit registration & settlement', iconName: 'Landmark' },
  { id: 'int-10', name: 'Leegality eSign & Stamp', category: 'eSign', status: 'READY', description: 'Aadhaar eSign & digital state stamp duty integration', iconName: 'PenTool' },
  { id: 'int-11', name: 'DigiLocker API', category: 'eSign', status: 'READY', description: 'Fetch official driving licenses, RC, property records', iconName: 'FolderCheck' },
  { id: 'int-12', name: 'WhatsApp Business API', category: 'Communication', status: 'READY', description: 'Automated loan status notifications, KFS delivery & payment reminders', iconName: 'MessageSquare' }
];

export const WHITE_LABEL_BRANDS: WhiteLabelBrand[] = [
  {
    id: 'brand-sniper',
    brandName: 'SNIPER Core System',
    primaryColor: '#2563EB',
    accentColor: '#1D4ED8',
    subdomain: 'app.sniperlending.in',
    logoText: 'SNIPER',
    kfsHeader: 'SNIPER FINANCIAL TECHNOLOGIES OPERATING SYSTEM',
    portalTitle: 'SNIPER Enterprise Borrower Portal'
  },
  {
    id: 'brand-abc',
    brandName: 'ABC Finance Limited',
    primaryColor: '#059669',
    accentColor: '#047857',
    subdomain: 'portal.abcfinance.com',
    logoText: 'ABC FINANCE',
    kfsHeader: 'ABC FINANCE LIMITED (NBFC-ND-SI)',
    portalTitle: 'ABC Finance Express Loan Hub'
  },
  {
    id: 'brand-prime',
    brandName: 'Prime Capital India',
    primaryColor: '#7C3AED',
    accentColor: '#6D28D9',
    subdomain: 'lending.primecapital.in',
    logoText: 'PRIME CAPITAL',
    kfsHeader: 'PRIME CAPITAL CREDIT SOLUTIONS PVT LTD',
    portalTitle: 'Prime Borrower Command Center'
  },
  {
    id: 'brand-bharat',
    brandName: 'Bharat Lending OS',
    primaryColor: '#D97706',
    accentColor: '#B45309',
    subdomain: 'apply.bharatlending.in',
    logoText: 'BHARAT LENDING',
    kfsHeader: 'BHARAT LENDING INFRASTRUCTURE PARTNERS',
    portalTitle: 'Bharat Micro-Lending Portal'
  }
];

export const INDUSTRY_MODELS: IndustryModel[] = [
  {
    id: 'ind-1',
    title: 'Personal Loans & Consumer Credit',
    subtitle: 'High-volume digital origination with instant e-Sign & auto-disbursement',
    avgTicketSize: '₹50,000 – ₹10,000,000',
    keyFeatures: ['Sub-3-minute approval flow', 'Automated eNACH debit mandate', 'Instant KFS generation & WhatsApp delivery', 'CIBIL + Experian instant pull'],
    description: 'Empower retail borrowers with friction-free digital onboarding, automated bank statement scoring, and sub-minute credit approvals.',
    badge: 'Retail'
  },
  {
    id: 'ind-2',
    title: 'Business & MSME Loans',
    subtitle: 'GST, Bank Statement, and Income Tax Return based intelligent underwriting',
    avgTicketSize: '₹5,00,000 – ₹5,00,00,000',
    keyFeatures: ['GSTR 3B/1 automated reconciliation', 'Perfios 12-month cashflow analyzer', 'Visual BRE with custom DSCR rules', 'Multi-level maker-checker workflow'],
    description: 'Designed for NBFCs servicing India’s vibrant MSME sector with comprehensive cashflow analytics and policy exception workflows.',
    badge: 'Commercial'
  },
  {
    id: 'ind-3',
    title: 'Loan Against Property (LAP)',
    subtitle: 'Secured credit workflow with property valuation and legal-technical verification',
    avgTicketSize: '₹20,00,000 – ₹25,00,00,000',
    keyFeatures: ['Collateral valuation tracking', 'Legal & Technical vendor portal', 'Multi-co-applicant management', 'Custom LTV & FOIR matrices'],
    description: 'Manage complex multi-party collateral, title searches, site inspection reports, and tranche disbursements.',
    badge: 'Secured'
  },
  {
    id: 'ind-4',
    title: 'Vehicle & Equipment Finance',
    subtitle: 'Dealer & RTO integration with automated chassis and RC verification',
    avgTicketSize: '₹2,00,000 – ₹50,00,00,000',
    keyFeatures: ['Dealer portal & commission tracking', 'Vahan RTO API verification', 'Subvention & insurance calculation', 'Field collection geo-fencing'],
    description: 'Streamline two-wheeler, commercial vehicle, and heavy machinery financing with instant dealer payout reconciliation.',
    badge: 'Asset Backed'
  },
  {
    id: 'ind-5',
    title: 'Supply Chain & Invoice Discounting',
    subtitle: 'Anchor-led vendor financing with ERP integration and invoice verification',
    avgTicketSize: '₹10,00,000 – ₹10,00,00,000',
    keyFeatures: ['Anchor buyer API connection', 'E-Way bill & GST invoice matching', 'Tripartite agreement eSign', 'Flexible bullet & EMI settlement'],
    description: 'Seamlessly connect corporate anchors, vendors, and lenders for automated invoice verification and instant liquidity.',
    badge: 'B2B Credit'
  },
  {
    id: 'ind-6',
    title: 'Microfinance & JLG Lending',
    subtitle: 'Field-agent offline mode, center meeting management, and biometric verification',
    avgTicketSize: '₹10,000 – ₹1,50,00,00',
    keyFeatures: ['Joint Liability Group (JLG) tracking', 'Biometric Aadhaar offline sync', 'Collection route optimization', 'RBI microfinance compliance limits'],
    description: 'Equip field agents with mobile apps that work seamlessly offline in remote areas with automatic center-meeting sync.',
    badge: 'Inclusive Credit'
  }
];

export const PORTFOLIO_SERIES_DATA = [
  { month: 'Jan', disbursementCr: 210, collectionsCr: 198, activeLoans: 6200, par30: 2.1 },
  { month: 'Feb', disbursementCr: 245, collectionsCr: 232, activeLoans: 6650, par30: 2.0 },
  { month: 'Mar', disbursementCr: 280, collectionsCr: 268, activeLoans: 7100, par30: 1.9 },
  { month: 'Apr', disbursementCr: 310, collectionsCr: 295, activeLoans: 7420, par30: 2.2 },
  { month: 'May', disbursementCr: 350, collectionsCr: 338, activeLoans: 7800, par30: 2.4 },
  { month: 'Jun', disbursementCr: 395, collectionsCr: 380, activeLoans: 8120, par30: 2.3 },
  { month: 'Jul', disbursementCr: 440, collectionsCr: 422, activeLoans: 8300, par30: 2.1 },
  { month: 'Aug', disbursementCr: 482, collectionsCr: 465, activeLoans: 8420, par30: 1.8 }
];

export const LIFECYCLE_STAGES = [
  { stage: '01. Lead Capture', dept: 'CRM', desc: 'Omnichannel lead capture from website, DSA, telecalling, and API partners with instant lead deduplication.' },
  { stage: '02. Customer 360', dept: 'CRM', desc: 'Single view of borrower history, existing relationships, income profile, and credit readiness.' },
  { stage: '03. Eligibility Check', dept: 'BRE', desc: 'Sub-second initial rule evaluation evaluating age, pin code serviceability, and basic parameters.' },
  { stage: '04. Application Filing', dept: 'LOS', desc: 'Dynamic digital application form tailored to loan product with co-applicant support.' },
  { stage: '05. Digital KYC', dept: 'Compliance', desc: 'Aadhaar eKYC, PAN verification, CKYC pull, and facial liveness match.' },
  { stage: '06. Document Collection', dept: 'LOS', desc: 'OCR parsing of bank statements, GST returns, payslips, and property papers with fraud detection.' },
  { stage: '07. Credit Bureau Pull', dept: 'Credit', desc: 'Automated dual bureau pull (CIBIL + Experian) with tradeline parsing and score analysis.' },
  { stage: '08. Banking & AA', dept: 'Credit', desc: 'Account Aggregator flow parsing 12 months of transactions, bounce rates, and average bank balance.' },
  { stage: '09. BRE Execution', dept: 'BRE', desc: 'Configurable business rules engine evaluating FOIR, LTV, DSCR, and credit policy limits.' },
  { stage: '10. Underwriting', dept: 'Underwriting', desc: 'Credit analyst workspace with AI credit summary, policy exception flagging, and CAM generation.' },
  { stage: '11. Approval & Sanction', dept: 'LOS', desc: 'Maker-checker approval matrix with automated sanction letter generation.' },
  { stage: '12. KFS Generation', dept: 'Compliance', desc: 'Regulatory Key Fact Statement (KFS) calculating exact APR, total cost, and repayment schedule.' },
  { stage: '13. Agreement eSign', dept: 'Compliance', desc: 'Aadhaar eSign & digital stamping of loan agreement with instant digital vaulting.' },
  { stage: '14. Disbursement', dept: 'Payments', desc: 'API disbursement via Razorpay/Cashfree to verified borrower bank account.' },
  { stage: '15. Loan Servicing', dept: 'LMS', desc: 'Core loan accounting, principal/interest allocation, fee accrual, and subversion tracking.' },
  { stage: '16. Auto EMI Payments', dept: 'Payments', desc: 'Automated eNACH / UPI recurring auto-debit processing on EMI due date.' },
  { stage: '17. Payment Recon', dept: 'Payments', desc: '98%+ automated bank statement matching using UTR and transaction matching rules.' },
  { stage: '18. Smart Collections', dept: 'Collections', desc: 'AI-driven collection queue, PTP tracking, WhatsApp payment links, and field allocation.' },
  { stage: '19. Risk & Recovery', dept: 'Risk', desc: 'Early warning signals, DPD escalation, legal notice workflows, and settlement matrix.' },
  { stage: '20. Loan Closure & NOC', dept: 'LMS', desc: 'Automated No Objection Certificate (NOC) generation upon final repayment settlement.' }
];
