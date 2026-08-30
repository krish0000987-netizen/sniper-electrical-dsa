import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Send, Sparkles, ShieldCheck, TrendingUp, AlertTriangle, Landmark, HandCoins, HelpCircle } from "lucide-react";
import { api, fmtInr, timeAgo } from "../lib/api";
import { PageHeader, Card, CardTitle, Badge } from "../components/ui";

interface Msg {
  role: "user" | "ai";
  text: string;
  result?: any;
}

const SUGGESTIONS = [
  { icon: AlertTriangle, label: "What needs my attention today?" },
  { icon: TrendingUp, label: "Top overdue accounts" },
  { icon: HandCoins, label: "Which leads are most likely to convert?" },
  { icon: Landmark, label: "Summarize the portfolio" },
  { icon: HandCoins, label: "Which PTPs are due this week?" },
  { icon: TrendingUp, label: "Which DSA is performing best?" }
];

export default function AI() {
  const [msgs, setMsgs] = useState<Msg[]>([{
    role: "ai",
    text: "Welcome to the SNIPER AI Command Center. Ask me about your pipeline, portfolio, overdue accounts or collections.",
    result: null
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api("/ai/history").then(setHistory); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const ask = async (prompt?: string) => {
    const q = (prompt ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await api("/ai/query", { method: "POST", body: { prompt: q } });
      setMsgs((m) => [...m, { role: "ai", text: res.headline || "Here's what I found.", result: res }]);
      api("/ai/history").then(setHistory);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "ai", text: `I hit an error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="SNIPER AI Command Center" sub="Search, summarize, analyze and recommend — always advisory, human decision required" breadcrumb="Intelligence / AI" />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2">
          <Card className="flex flex-col h-[560px]">
            <div className="flex items-center gap-2.5 pb-3 border-b border-zinc-100 mb-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-600 to-violet-600 text-white flex items-center justify-center"><BrainCircuit size={15} /></div>
              <div>
                <div className="text-[13px] font-semibold text-zinc-900">SNIPER AI</div>
                <div className="text-[10.5px] text-zinc-400">Rule-informed analytics over your live data</div>
              </div>
              <Badge status="sandbox">ADVISORY</Badge>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {msgs.map((m, i) => (
                <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${m.role === "user" ? "bg-zinc-100 text-zinc-600" : "bg-gradient-to-br from-brand-600 to-violet-600 text-white"}`}>
                    {m.role === "user" ? "U" : <Sparkles size={12} />}
                  </div>
                  <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${m.role === "user" ? "bg-brand-600 text-white rounded-tr-sm" : "bg-zinc-50 border border-zinc-100 rounded-tl-sm text-zinc-700"}`}>
                    <div>{m.text}</div>
                    {m.result?.items && (
                      <div className="mt-2 space-y-1.5">
                        {m.result.items.map((it: any, j: number) => (
                          <div key={j} className="flex items-center gap-2 text-[12px]">
                            <span className={`w-1.5 h-1.5 rounded-full ${it.severity === "high" ? "bg-rose-500" : it.severity === "medium" ? "bg-amber-500" : it.severity === "info" ? "bg-brand-500" : "bg-emerald-500"}`} />
                            <span className={m.role === "user" ? "" : it.severity === "high" ? "text-rose-700 font-medium" : it.severity === "medium" ? "text-amber-700" : "text-zinc-600"}>{it.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.result?.rows && (
                      <div className="mt-2 rounded-lg border border-zinc-100 bg-white overflow-hidden">
                        <table className="w-full text-[11px]">
                          <tbody>
                            {m.result.rows.slice(0, 8).map((r: any, j: number) => (
                              <tr key={j} className="border-t border-zinc-50 first:border-0">
                                <td className="px-2.5 py-1.5 font-medium">{r.customer || r.name || r.dsa || r.loan_no || r.month}</td>
                                <td className="px-2.5 py-1.5 text-right num">{r.outstanding ? fmtInr(r.outstanding) : r.score ? `${r.score} score` : r.amount ? fmtInr(r.amount) : r.dpd ? `${r.dpd} DPD` : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && <div className="flex gap-2.5"><div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-600 to-violet-600 text-white flex items-center justify-center"><Sparkles size={12} /></div><div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 flex gap-1"><span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" /><span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce [animation-delay:100ms]" /><span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce [animation-delay:200ms]" /></div></div>}
              <div ref={bottomRef} />
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-zinc-100 mt-3">
              <input
                className="input flex-1"
                placeholder="Ask SNIPER AI…  e.g. “What needs my attention today?”"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
              />
              <button className="btn btn-primary" onClick={() => ask()} disabled={!input.trim() || busy}><Send size={13} /></button>
            </div>
          </Card>

          <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
            <ShieldCheck size={12} className="text-emerald-500" />
            Every query is logged with user, timestamp and result. AI never modifies financial records — recommendations only.
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle title="Try asking" />
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s.label} className="w-full flex items-center gap-2.5 rounded-lg border border-zinc-100 px-3 py-2.5 text-[12px] text-zinc-700 hover:border-brand-200 hover:bg-brand-50/40 cursor-pointer text-left" onClick={() => ask(s.label)}>
                  <s.icon size={14} className="text-zinc-400" />
                  {s.label}
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <CardTitle title="Recent AI activity" sub="Audited queries" />
            <div className="space-y-2.5">
              {history.slice(0, 8).map((h: any) => (
                <div key={h.id} className="text-[11.5px]">
                  <div className="text-zinc-600 truncate">{h.prompt}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{timeAgo(h.created_at)}</div>
                </div>
              ))}
              {!history.length && <div className="text-[11.5px] text-zinc-400">No AI queries yet — ask something above.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
