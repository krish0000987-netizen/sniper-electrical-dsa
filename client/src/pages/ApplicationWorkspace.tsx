import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Check, ChevronRight, Circle, FileText, RefreshCw, Scale, Zap, Fingerprint,
  Landmark, ShieldCheck, AlertTriangle, Bot, Clock, UserCheck, FileSignature, Send
} from "lucide-react";
import { api, fmtInr, fmtDate, timeAgo, badgeFor, statusLabel, STAGE_LABELS } from "../lib/api";
import { Card, CardTitle, Badge, KV, Tabs, Modal, Field, PageHeader, Progress } from "../components/ui";
import { LosToolsPanel } from "../components/LosToolsPanel";

const STAGE_ORDER = ["application", "kyc", "documents", "credit", "banking", "gst", "bre", "underwriting", "approval", "sanction", "kfs", "agreement", "esign", "disbursement"];

export default function ApplicationWorkspace() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState("workflow");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [decideOpen, setDecideOpen] = useState(false);
  const [decide, setDecide] = useState<any>({ decision: "approve", note: "", approved_amount: 0 });

  const load = () => api(`/applications/${id}`).then(setData);
  useEffect(() => { load(); }, [id]);
  useEffect(() => { if (data) setDecide((d: any) => ({ ...d, approved_amount: data.app.approved_amount || data.app.requested_amount })); }, [data?.app?.id]);

  if (!data) return null;
  const { app, stages, documents, bureau, bank, gst, evaluations, ctx, rules, sanction, kfs, agreements, existingLoans, approvals, hub } = data;
  const panHub = hub?.panVerify;
  const panLive = panHub?.mode === "live" && panHub?.effectiveStatus === "connected";
  const panLiveIntent = panHub?.mode === "live" && !panLive && panHub?.credentialsConfigured && panHub?.effectiveStatus !== "error";

  const act = async (action: string, fn: () => Promise<any>, okMsg?: string) => {
    setBusy(action);
    try {
      await fn();
      await load();
      setToast(okMsg || `${action} completed`);
      setTimeout(() => setToast(""), 3500);
    } catch (e: any) {
      setToast(`Error: ${e.message}`);
      setTimeout(() => setToast(""), 5000);
    } finally {
      setBusy("");
    }
  };

  const stageIdx = STAGE_ORDER.indexOf(app.stage);
  const capacity = ctx?.capacity;
  const breDetail = app.bre_result !== "pending" ? { eligible: app.bre_result === "eligible", riskGrade: app.risk_grade } : null;
  const currentStage = stages.find((s: any) => s.code === app.stage);

  return (
    <div className="relative">
      <PageHeader
        title={app.application_no}
        sub={`${app.customer_name} · ${app.product_name} · requested ${fmtInr(app.requested_amount)} · ${app.tenure || "—"} months`}
        breadcrumb={`LOS / Applications / ${app.application_no}`}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => nav("/applications")}><ArrowLeft size={13} /> Back</button>
            {existingLoans?.[0] && <button className="btn btn-secondary" onClick={() => nav(`/loans/${existingLoans[0].id}`)}><Landmark size={13} /> Open loan</button>}
          </>
        }
      />

      {/* Workflow stepper */}
      <Card className="mb-4" pad={false}>
        <div className="flex items-center gap-0 overflow-x-auto px-4 py-3">
          {STAGE_ORDER.map((s, i) => {
            const done = i < stageIdx;
            const current = i === stageIdx;
            return (
              <div key={s} className="flex items-center shrink-0">
                <div className={`flex flex-col items-center gap-1 w-16`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${done ? "bg-emerald-500 text-white" : current ? "bg-brand-600 text-white ring-4 ring-brand-100" : "bg-zinc-100 text-zinc-400"}`}>
                    {done ? <Check size={11} /> : i + 1}
                  </div>
                  <span className={`text-[9px] font-medium text-center leading-tight ${current ? "text-brand-700" : done ? "text-zinc-500" : "text-zinc-300"}`}>{STAGE_LABELS[s]}</span>
                </div>
                {i < STAGE_ORDER.length - 1 && <div className={`w-6 h-px mb-4 ${i < stageIdx ? "bg-emerald-400" : "bg-zinc-200"}`} />}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[240px_1fr_280px] gap-4 items-start">
        {/* LEFT — customer & context */}
        <div className="space-y-4">
          <Card>
            <CardTitle title="Customer" right={<button className="text-[11px] text-brand-600 font-medium cursor-pointer" onClick={() => nav(`/customers/${app.customer_id}`)}>360 view</button>} />
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-[12px] font-semibold">{app.customer_name?.split(" ").map((n: string) => n[0]).slice(0, 2).join("")}</div>
              <div>
                <div className="text-[13px] font-semibold text-zinc-800">{app.customer_name}</div>
                <div className="text-[11px] text-zinc-400">{app.mobile || ""}</div>
              </div>
            </div>
            <KV k="Employment" v={<span className="capitalize">{app.employment_type || "—"}</span>} />
            <KV k="Monthly income" v={fmtInr(app.monthly_income)} mono />
            <KV k="Turnover" v={fmtInr(app.business_turnover)} mono />
            <KV k="City" v={app.city || "—"} />
            <KV k="PAN" v={app.pan || "—"} mono />
          </Card>

          <Card>
            <CardTitle title="Loan request" />
            <KV k="Product" v={app.product_name} />
            <KV k="Requested" v={fmtInr(app.requested_amount)} mono />
            <KV k="Approved" v={app.approved_amount ? fmtInr(app.approved_amount) : "—"} mono />
            <KV k="Tenure" v={`${app.tenure || "—"} months`} mono />
            <KV k="Purpose" v={<span className="text-[11px] leading-snug block max-w-[130px]">{app.purpose || "—"}</span>} />
            <KV k="Rate (product)" v={`${app.interest_rate}% p.a.`} mono />
            <KV k="Source" v={<span className="capitalize">{app.source || "—"}</span>} />
            {app.dsa_id && <KV k="DSA" v={`Partner #${app.dsa_id}`} />}
            {app.credit_officer_name && <KV k="Credit officer" v={app.credit_officer_name} />}
          </Card>

          <Card>
            <CardTitle title="Documents" sub={`${documents.filter((d: any) => d.status === "verified").length}/${documents.length} verified`} />
            <div className="space-y-1.5">
              {documents.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between gap-2 py-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={12} className="text-zinc-300 shrink-0" />
                    <span className="text-[11.5px] text-zinc-600 capitalize truncate">{d.category.replace(/_/g, " ")}</span>
                  </div>
                  <Badge status={d.status} />
                </div>
              ))}
              {!documents.length && <div className="text-[11.5px] text-zinc-400 py-2">No documents yet.</div>}
            </div>
            {currentStage?.required_documents && JSON.parse(currentStage.required_documents || "[]").length > 0 && (
              <div className="mt-2 pt-2 border-t border-zinc-100 text-[10.5px] text-amber-600">
                Required: {JSON.parse(currentStage.required_documents).map((r: string) => r.replace(/_/g, " ")).join(", ")}
              </div>
            )}
          </Card>
        </div>

        {/* CENTER — workflow & analysis */}
        <div>
          <Tabs
            active={tab}
            onChange={setTab}
            items={[
              { key: "workflow", label: "Workflow" },
              { key: "tools", label: "LOS Tools" },
              { key: "credit", label: "Credit", count: bureau ? 1 : 0 },
              { key: "banking", label: "Banking", count: bank ? 1 : 0 },
              { key: "bre", label: "Rules (BRE)", count: evaluations?.length },
              { key: "kfs", label: "KFS & Docs", count: kfs ? 1 : 0 },
              { key: "approvals", label: "Approvals", count: approvals?.length }
            ]}
          />

          {tab === "tools" && <LosToolsPanel app={app} />}

          {tab === "workflow" && (
            <Card>
              <CardTitle title={`Stage: ${STAGE_LABELS[app.stage]}`} sub={<SlaChip stage={currentStage} />} />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <MiniStat label="BRE result" value={app.bre_result === "pending" ? "Pending" : statusLabel(app.bre_result)} tone={app.bre_result === "eligible" ? "green" : app.bre_result === "rejected" ? "red" : "gray"} />
                <MiniStat label="Risk grade" value={app.risk_grade || "—"} tone={app.risk_grade === "high" ? "red" : app.risk_grade === "medium" ? "amber" : "green"} />
                <MiniStat label="Fraud score" value={app.fraud_score != null ? `${app.fraud_score}` : "—"} tone={app.fraud_score >= 60 ? "red" : app.fraud_score >= 35 ? "amber" : "green"} />
                <MiniStat label="Decision" value={app.decision === "pending" ? "Pending" : statusLabel(app.decision)} tone={app.decision === "approve" ? "green" : app.decision === "reject" ? "red" : "amber"} />
                <MiniStat label="Capacity surplus" value={capacity?.surplus != null ? fmtInr(capacity.surplus) : "—"} tone={(capacity?.surplus ?? 0) > 0 ? "green" : "red"} />
                <MiniStat label="FOIR" value={capacity?.foir != null ? `${capacity.foir}%` : "—"} tone={(capacity?.foir ?? 0) <= 55 ? "green" : "red"} />
              </div>

              <div className="border-t border-zinc-100 pt-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Stage actions</div>
                <div className="flex flex-wrap gap-2">
                  {app.stage === "kyc" && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => act("kyc", () => api(`/applications/${app.id}/kyc`, { method: "POST", body: { type: "pan" } }), panLive ? "PAN verified via Digitap" : panLiveIntent ? "KYC request sent (Digitap pending enablement)" : "KYC verification completed (sandbox)")}><Fingerprint size={13} /> {busy === "kyc" ? "Checking…" : panLive ? "Verify PAN (Digitap)" : panLiveIntent ? "Verify PAN (pending Digitap)" : "Verify KYC (sandbox)"}</button>
                  )}
                  {(app.stage === "credit" || app.stage === "banking" || app.stage === "gst") && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => act("credit", () => api(`/applications/${app.id}/credit`, { method: "POST" }), "Credit data fetched (sandbox adapters)")}><RefreshCw size={13} /> {busy === "credit" ? "Fetching…" : "Fetch credit data (sandbox)"}</button>
                  )}
                  {app.stage === "bre" && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => act("bre", () => api(`/applications/${app.id}/bre`, { method: "POST" }), "Rules engine evaluated")}><Scale size={13} /> {busy === "bre" ? "Evaluating…" : "Run business rules"}</button>
                  )}
                  {app.stage === "underwriting" && (
                    <>
                      <button className="btn btn-primary" onClick={() => setDecideOpen(true)}><UserCheck size={13} /> Underwriting decision</button>
                      <button className="btn btn-secondary" onClick={() => act("advance", () => api(`/applications/${app.id}/advance`, { method: "POST" }))}>Move to approval <ChevronRight size={13} /></button>
                    </>
                  )}
                  {app.stage === "approval" && <button className="btn btn-primary" onClick={() => setDecideOpen(true)}><UserCheck size={13} /> Approve / Reject</button>}
                  {app.stage === "sanction" && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => act("sanction", () => api(`/applications/${app.id}/sanction`, { method: "POST" }), "Sanction letter issued")}><FileSignature size={13} /> {busy === "sanction" ? "Issuing…" : "Issue sanction letter"}</button>
                  )}
                  {app.stage === "kfs" && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => act("kfs", () => api(`/applications/${app.id}/kfs`, { method: "POST" }), "KFS generated & validated")}><FileText size={13} /> {busy === "kfs" ? "Generating…" : "Generate Key Fact Statement"}</button>
                  )}
                  {(app.stage === "agreement" || app.stage === "esign") && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => act("agreement", () => api(`/applications/${app.id}/agreement`, { method: "POST" }), "Agreement e-signed (SANDBOX provider)")}><FileSignature size={13} /> {busy === "agreement" ? "Signing…" : "E-sign agreement (SANDBOX)"}</button>
                  )}
                  {app.stage === "disbursement" && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => act("disburse", () => api(`/applications/${app.id}/disburse`, { method: "POST" }), "Loan disbursed — account created")}><Send size={13} /> {busy === "disburse" ? "Dispatching…" : "Authorize disbursement"}</button>
                  )}
                  {app.stage !== "disbursement" && app.decision === "pending" && app.status !== "rejected" && (
                    <button className="btn btn-secondary" disabled={!!busy} onClick={() => act("advance", () => api(`/applications/${app.id}/advance`, { method: "POST" }))}>Advance stage <ChevronRight size={13} /></button>
                  )}
                </div>
                {app.decision === "reject" && <div className="mt-3 text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">Application declined — {app.decision_note || "per credit policy"}</div>}
              </div>
            </Card>
          )}

          {tab === "credit" && (
            bureau ? <BureauReport bureau={bureau} /> : <Card><CardTitle title="Credit bureau" /><div className="text-[12px] text-zinc-400 py-6 text-center">Fetch credit data to view the mock bureau report.</div></Card>
          )}
          {tab === "banking" && (
            bank ? <BankAnalysis bank={bank} gst={gst} /> : <Card><CardTitle title="Bank analysis" /><div className="text-[12px] text-zinc-400 py-6 text-center">Fetch credit data to view bank statement analysis.</div></Card>
          )}
          {tab === "bre" && <BREResult evaluations={evaluations} app={app} rules={rules} />}
          {tab === "kfs" && <KFSView kfs={kfs} sanction={sanction} agreements={agreements} app={app} />}
          {tab === "approvals" && <Approvals approvals={approvals} app={app} />}
        </div>

        {/* RIGHT — risk, AI, SLA, decision */}
        <div className="space-y-4">
          <Card>
            <CardTitle title="Decision" />
            {app.decision === "pending" ? (
              <div className="space-y-2">
                <button className="btn btn-primary w-full" onClick={() => setDecideOpen(true)}><UserCheck size={13} /> Make decision</button>
                <div className="text-[10.5px] text-zinc-400">Approval matrix enforced by amount tier</div>
              </div>
            ) : (
              <div>
                <Badge status={app.decision} />
                {app.decision_by && <div className="text-[11px] text-zinc-500 mt-2">By user #{app.decision_by} · {fmtDate(app.decision_at)}</div>}
                {app.decision_note && <div className="text-[11.5px] text-zinc-600 mt-1.5">{app.decision_note}</div>}
              </div>
            )}
            {approvals?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-zinc-100">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">Approval trail</div>
                {approvals.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between py-1 text-[11px]">
                    <span className="text-zinc-600 capitalize">{a.action} · L{a.level}</span>
                    <Badge status={a.status} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle title="SNIPER AI assistant" right={<Bot size={14} className="text-brand-500" />} />
            <div className="text-[11.5px] text-zinc-600 leading-relaxed space-y-2">
              <p><span className="font-semibold text-zinc-800">Application summary:</span> {app.customer_name} requests {fmtInr(app.requested_amount)} for {app.purpose || "unspecified purpose"} over {app.tenure || "—"} months.</p>
              {capacity?.foir != null && <p><span className="font-semibold text-zinc-800">Capacity:</span> FOIR {capacity.foir}% with {fmtInr(capacity.surplus)} surplus after {fmtInr(capacity.obligations)} obligations.</p>}
              {bureau && <p><span className="font-semibold text-zinc-800">Credit:</span> score {bureau.score} ({bureau.score_band}), utilization {bureau.credit_utilization}%, max DPD {bureau.dpd_max}.</p>}
              {breDetail && <p><span className="font-semibold text-zinc-800">Rules:</span> {breDetail.eligible ? "eligible per active policy" : "rejected by BRE"} — grade {breDetail.riskGrade}.</p>}
              {(!capacity?.foir && !bureau && !breDetail) && <p>Fetch credit and run BRE for a deeper analysis.</p>}
            </div>
            <div className="mt-2 text-[10px] text-zinc-400 border-t border-zinc-100 pt-2">AI is advisory only — human decision required.</div>
          </Card>

          <Card>
            <CardTitle title="SLA & timing" right={<Clock size={14} className="text-zinc-300" />} />
            <KV k="Stage SLA" v={`${currentStage?.sla_hours ?? 24} hours`} />
            <KV k="Created" v={timeAgo(app.created_at)} />
            <KV k="In current stage" v={(() => {
              const h = data.stageHistory?.find((s: any) => s.stage === app.stage && !s.exited_at);
              return h ? timeAgo(h.entered_at) : "—";
            })()} />
            <KV k="Risk grade" v={app.risk_grade || "—"} />
          </Card>

          <Card>
            <CardTitle title="Fraud & risk" />
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11.5px] text-zinc-500">Fraud score</span>
              <span className={`num font-bold text-[16px] ${app.fraud_score >= 60 ? "text-rose-600" : app.fraud_score >= 35 ? "text-amber-600" : "text-emerald-600"}`}>{app.fraud_score ?? "—"}</span>
            </div>
            <Progress value={app.fraud_score ?? 0} tone={app.fraud_score >= 60 ? "red" : app.fraud_score >= 35 ? "amber" : "green"} />
            <div className="mt-3">
              {app.stage === "credit" && (
                <button className="btn btn-secondary btn-sm w-full" disabled={!!busy} onClick={() => act("fraud", () => api(`/applications/${app.id}/fraud`, { method: "POST" }), "Fraud checks completed")}><ShieldCheck size={12} /> Run fraud checks</button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Decision modal */}
      <Modal open={decideOpen} onClose={() => setDecideOpen(false)} title="Underwriting decision">
        <div className="space-y-3">
          <Field label="Decision">
            <select className="input" value={decide.decision} onChange={(e) => setDecide({ ...decide, decision: e.target.value })}>
              <option value="approve">Approve</option>
              <option value="approve_with_conditions">Approve with conditions</option>
              <option value="send_back">Send back for more info</option>
              <option value="reject">Reject</option>
            </select>
          </Field>
          {(decide.decision === "approve" || decide.decision === "approve_with_conditions") && (
            <Field label="Approved amount"><input className="input num" type="number" value={decide.approved_amount} onChange={(e) => setDecide({ ...decide, approved_amount: e.target.value })} /></Field>
          )}
          <Field label="Note"><textarea className="input min-h-20" value={decide.note} onChange={(e) => setDecide({ ...decide, note: e.target.value })} placeholder="Credit memo reference, conditions, rationale…" /></Field>
          <div className="text-[11px] text-zinc-400 bg-zinc-50 border border-zinc-100 rounded-md px-3 py-2">
            Decisions are audited (who, what, when, before/after) and routed through the configurable approval matrix.
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" onClick={() => setDecideOpen(false)}>Cancel</button>
          <button className={`btn ${decide.decision === "reject" ? "btn-danger" : "btn-primary"}`} disabled={!!busy} onClick={async () => {
            await act("decide", () => api(`/applications/${app.id}/decide`, { method: "POST", body: { ...decide, approved_amount: Number(decide.approved_amount) } }), `Decision recorded: ${decide.decision}`);
            setDecideOpen(false);
          }}>Record decision</button>
        </div>
      </Modal>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-zinc-900 text-white text-[12px] font-medium px-4 py-2.5 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function SlaChip({ stage }: { stage: any }) {
  if (!stage?.entered_at) return <>SLA {stage?.sla_hours ?? 24}h</>;
  const sla = stage.sla_hours || 24;
  const entered = new Date(stage.entered_at).getTime();
  const elapsed = Math.max(0, (Date.now() - entered) / 3600000);
  const pct = Math.round((elapsed / sla) * 100);
  const status = pct >= 100 ? "breached" : pct >= 70 ? "at_risk" : "on_track";
  return (
    <span className="flex items-center gap-2">
      <span>SLA {sla}h · status {stage.status}</span>
      <span className={`${status === "breached" ? "badge-red" : status === "at_risk" ? "badge-amber" : "badge-green"}`}>{status.replace("_", " ")} · {Math.round(elapsed)}h / {sla}h</span>
    </span>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "green" | "red" | "amber" | "gray" }) {
  const tones = { green: "text-emerald-600", red: "text-rose-600", amber: "text-amber-600", gray: "text-zinc-600" };
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400 font-medium">{label}</div>
      <div className={`text-[15px] font-semibold num mt-0.5 ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function BureauReport({ bureau }: { bureau: any }) {
  return (
    <Card>
      <CardTitle title="SNIPER Credit Insight" sub={`${bureau.provider} · fetched ${fmtDate(bureau.fetched_at)}`} right={<Badge status="sandbox">SANDBOX</Badge>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-zinc-100 p-3 text-center">
          <div className={`text-[26px] font-bold num ${bureau.score >= 750 ? "text-emerald-600" : bureau.score >= 650 ? "text-amber-600" : "text-rose-600"}`}>{bureau.score}</div>
          <div className="text-[10px] text-zinc-400 uppercase tracking-wide mt-1">Credit score</div>
        </div>
        <div className="rounded-lg border border-zinc-100 p-3">
          <div className="num text-[18px] font-semibold">{bureau.active_accounts}</div>
          <div className="text-[10px] text-zinc-400 uppercase tracking-wide mt-1">Active accounts</div>
        </div>
        <div className="rounded-lg border border-zinc-100 p-3">
          <div className="num text-[18px] font-semibold">{bureau.credit_utilization}%</div>
          <div className="text-[10px] text-zinc-400 uppercase tracking-wide mt-1">Utilization</div>
        </div>
        <div className="rounded-lg border border-zinc-100 p-3">
          <div className={`num text-[18px] font-semibold ${bureau.dpd_max > 30 ? "text-rose-600" : "text-emerald-600"}`}>{bureau.dpd_max}</div>
          <div className="text-[10px] text-zinc-400 uppercase tracking-wide mt-1">Max DPD (days)</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-8">
        <div>
          <KV k="Score band" v={bureau.score_band} />
          <KV k="Total accounts" v={bureau.total_accounts} mono />
          <KV k="Closed accounts" v={bureau.closed_accounts} mono />
          <KV k="Overdue accounts" v={<span className={bureau.overdue_accounts ? "text-rose-600" : ""}>{bureau.overdue_accounts}</span>} mono />
        </div>
        <div>
          <KV k="Total outstanding" v={fmtInr(bureau.total_outstanding)} mono />
          <KV k="Enquiries (6m)" v={bureau.enquiries_6m} mono />
          <KV k="Write-offs" v={bureau.writeoffs} mono />
          <KV k="Settlements" v={bureau.settlements} mono />
        </div>
      </div>
      {bureau.is_mock && <div className="mt-3 text-[10.5px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2.5 py-2">Mock adapter output — configured for TransUnion CIBIL / Experian / Equifax / CRIF via the integration hub. No live bureau was queried.</div>}
    </Card>
  );
}

function BankAnalysis({ bank, gst }: { bank: any; gst: any }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle title="Bank statement analysis" sub={`${bank.provider} · ${bank.months_analyzed} months parsed`} right={<Badge status="sandbox">SANDBOX</Badge>} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Metric label="Monthly income" value={fmtInr(bank.monthly_income)} />
          <Metric label="Monthly expense" value={fmtInr(bank.monthly_expense)} />
          <Metric label="Avg balance" value={fmtInr(bank.avg_balance)} />
          <Metric label="Surplus" value={fmtInr(bank.banking_surplus)} tone={(bank.banking_surplus ?? 0) > 0 ? "green" : "red"} />
        </div>
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            <KV k="EMI obligations" v={fmtInr(bank.emi_obligations)} mono />
            <KV k="Cheque bounces" v={<span className={bank.bounce_count > 2 ? "text-rose-600" : ""}>{bank.bounce_count}</span>} mono />
            <KV k="Cash deposits" v={fmtInr(bank.cash_deposits)} mono />
          </div>
          <div>
            <KV k="Annual turnover" v={fmtInr(bank.turnover)} mono />
            <KV k="Banking risk" v={<Badge status={bank.risk} />} />
          </div>
        </div>
      </Card>
      {gst && (
        <Card>
          <CardTitle title="GST profile" sub={`${gst.provider || "MOCK-GST"} · ${gst.gstin || ""}`} right={<Badge status="sandbox">SANDBOX</Badge>} />
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <KV k="Annual turnover" v={fmtInr(gst.turnover)} mono />
              <KV k="Filing status" v={<Badge status={gst.filing_status === "filed" ? "verified" : "pending"} />} />
            </div>
            <div>
              <KV k="Filing frequency" v={gst.filing_frequency} />
              <KV k="Declared vs banking" v={`${gst.declared_vs_banking_pct}%`} mono />
              <KV k="GST risk" v={<Badge status={gst.risk} />} />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-lg border border-zinc-100 p-3">
      <div className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</div>
      <div className={`num text-[16px] font-semibold mt-1 ${tone === "green" ? "text-emerald-600" : tone === "red" ? "text-rose-600" : "text-zinc-800"}`}>{value}</div>
    </div>
  );
}

function BREResult({ evaluations, app, rules }: { evaluations: any[]; app: any; rules: any[] }) {
  return (
    <Card>
      <CardTitle title="Business Rule Engine" sub={`${rules.length} active policy rules evaluated in priority order`} right={<Badge status={app.bre_result} />} />
      {app.bre_detail ? (
        <div className="space-y-4">
          <div className={`rounded-lg px-4 py-3 ${app.bre_result === "eligible" ? "bg-emerald-50 border border-emerald-100" : "bg-rose-50 border border-rose-100"}`}>
            <div className="flex items-center gap-2">
              {app.bre_result === "eligible" ? <Check size={15} className="text-emerald-600" /> : <AlertTriangle size={15} className="text-rose-600" />}
              <span className="font-semibold text-[13px]">{app.bre_result === "eligible" ? "Application eligible under current policy" : "Application rejected by policy rules"}</span>
            </div>
            <div className="text-[11.5px] text-zinc-600 mt-1.5">Risk grade: <span className="font-semibold capitalize">{app.risk_grade}</span></div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Rule evaluation history</div>
            <div className="space-y-1.5">
              {evaluations.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between rounded-md border border-zinc-100 px-3 py-2">
                  <div>
                    <div className="text-[12px] font-medium text-zinc-700">Rule #{e.rule_id}</div>
                    <div className="text-[10.5px] text-zinc-400">{fmtDate(e.evaluated_at)}</div>
                  </div>
                  {e.passed ? <Badge status="verified">PASS</Badge> : <Badge status="rejected">FAIL</Badge>}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-zinc-400 py-6 text-center">Run the business rules engine to evaluate this application against {rules.length} active rules.</div>
      )}
    </Card>
  );
}

function KFSView({ kfs, sanction, agreements, app }: { kfs: any; sanction: any; agreements: any[]; app: any }) {
  const content = kfs ? JSON.parse(kfs.content) : null;
  return (
    <div className="space-y-4">
      {sanction && (
        <Card>
          <CardTitle title="Sanction letter" sub={sanction.sanction_no} right={<Badge status={sanction.status} />} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Amount" value={fmtInr(sanction.amount)} />
            <Metric label="Tenure" value={`${sanction.tenure} months`} />
            <Metric label="Rate" value={`${sanction.rate}%`} />
            <Metric label="EMI" value={fmtInr(sanction.emi)} />
          </div>
          {JSON.parse(sanction.conditions || "[]").length > 0 && (
            <div className="mt-3 text-[11.5px] text-zinc-600">
              <span className="font-semibold text-zinc-700">Conditions: </span>
              {JSON.parse(sanction.conditions).join(" · ")}
            </div>
          )}
        </Card>
      )}
      {kfs && content ? (
        <Card>
          <CardTitle title="Key Fact Statement" sub={`Version ${kfs.version} · generated ${fmtDate(kfs.generated_at)}`} right={<Badge status={content.compliance_status === "blocked" ? "blocked" : "compliant"} />} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Metric label="Loan amount" value={fmtInr(content.loan_amount)} />
            <Metric label="EMI" value={fmtInr(content.emi)} />
            <Metric label="APR (incl. fees)" value={`${content.apr}%`} />
            <Metric label="Total repayment" value={fmtInr(content.total_repayment)} />
          </div>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <KV k="Interest rate" v={`${content.annual_interest_rate}% ${content.interest_type}`} />
              <KV k="Tenure" v={`${content.tenure_months} months`} />
              <KV k="Total interest" v={fmtInr(content.total_interest)} mono />
              <KV k="Total fees" v={fmtInr(content.total_fees)} mono />
            </div>
            <div>
              <KV k="Processing fee" v={fmtInr(content.fee_breakup?.processing_fee)} mono />
              <KV k="Fee GST" v={fmtInr(content.fee_breakup?.processing_fee_gst)} mono />
              <KV k="Penal rate" v={`${content.penal_rate}% p.a.`} />
              <KV k="Foreclosure charge" v={`${content.foreclosure_charge_pct}%`} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Amortization preview (first 12 installments)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="border-b border-zinc-100 text-zinc-400 text-left">
                  <th className="py-1.5 pr-2">#</th><th className="py-1.5 pr-2">Due</th><th className="py-1.5 pr-2 text-right">EMI</th><th className="py-1.5 pr-2 text-right">Principal</th><th className="py-1.5 pr-2 text-right">Interest</th><th className="py-1.5 text-right">Closing</th>
                </tr></thead>
                <tbody>
                  {content.schedule_preview?.map((r: any) => (
                    <tr key={r.seq} className="border-b border-zinc-50">
                      <td className="py-1.5 pr-2 num text-zinc-400">{r.seq}</td>
                      <td className="py-1.5 pr-2">{fmtDate(r.due)}</td>
                      <td className="py-1.5 pr-2 text-right num">{fmtInr(r.emi)}</td>
                      <td className="py-1.5 pr-2 text-right num">{fmtInr(r.principal)}</td>
                      <td className="py-1.5 pr-2 text-right num">{fmtInr(r.interest)}</td>
                      <td className="py-1.5 text-right num text-zinc-500">{fmtInr(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 text-[10.5px] text-zinc-400 bg-zinc-50 border border-zinc-100 rounded-md px-3 py-2">
            KFS versioned and linked to proposal · APR and charges disclosed per configurable compliance policy · blockers flagged, never silently ignored.
          </div>
        </Card>
      ) : (
        <Card><CardTitle title="Key Fact Statement" /><div className="text-[12px] text-zinc-400 py-6 text-center">Generate the KFS after sanction is issued.</div></Card>
      )}
      {agreements?.length > 0 && (
        <Card>
          <CardTitle title="Loan agreement" sub="E-sign status" />
          {agreements.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between py-2">
              <div>
                <div className="text-[12.5px] font-medium text-zinc-700">{a.template}</div>
                <div className="text-[10.5px] text-zinc-400">Signed by {a.signer_name} · {fmtDate(a.signed_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={a.status} />
                <span className="text-[9.5px] text-zinc-400 font-mono">{a.hash?.slice(0, 14)}…</span>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Approvals({ approvals, app }: { approvals: any[]; app: any }) {
  return (
    <Card>
      <CardTitle title="Approval records" sub="Maker-checker trail for this application" />
      {approvals?.length ? approvals.map((a: any) => (
        <div key={a.id} className="flex items-center justify-between py-2.5 border-b border-zinc-50 last:border-0">
          <div>
            <div className="text-[12.5px] font-medium capitalize text-zinc-700">{a.action}</div>
            <div className="text-[10.5px] text-zinc-400">Level {a.level} · {fmtDate(a.decided_at || a.created_at)}</div>
          </div>
          <Badge status={a.status} />
        </div>
      )) : (
        <div className="text-[12px] text-zinc-400 py-6 text-center">No approvals recorded yet.</div>
      )}
    </Card>
  );
}
