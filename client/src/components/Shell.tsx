import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, PhoneCall, UserCircle2, FileText, ListChecks, ShieldCheck, Scale,
  Landmark, Wallet, HandCoins, Building2, BadgeCheck, ScrollText, BarChart3, BrainCircuit,
  Settings2, Plug2, Search, Bell, LogOut, ChevronRight, Activity, AlertTriangle, FileSearch,
  Globe2, GitPullRequest, Store, Handshake, Coins, HeartPulse, Megaphone, RefreshCw, Zap, Calculator, SlidersHorizontal, ListTodo, Wrench,
  UsersRound, UserPlus, Layers, Rocket, Plug, TrendingUp, Inbox, BookOpen, LifeBuoy, GitCommitHorizontal, Trash2
} from "lucide-react";
import { api, fmtDateTime, timeAgo } from "../lib/api";
import { useAuth, ROLE_LABELS } from "../lib/auth";
import { useGnPerms, matchesPerm } from "../lib/gn";

type NavItem = { to: string; label: string; icon: any; end?: boolean; perm?: string };
type NavGroup = { section: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { section: "Overview", items: [{ to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  {
    section: "CRM", items: [
      { to: "/leads", label: "Leads", icon: FileText },
      { to: "/telecall", label: "Telecalling", icon: PhoneCall },
      { to: "/customers", label: "Customers", icon: Users }
    ]
  },
  {
    section: "LOS — Origination", items: [
      { to: "/applications", label: "Applications", icon: ListChecks },
      { to: "/underwriting", label: "Underwriting", icon: FileSearch },
      { to: "/bre", label: "Rule Engine", icon: Scale },
      { to: "/credit", label: "Credit & Risk", icon: ShieldCheck }
    ]
  },
  {
    section: "LMS — Servicing", items: [
      { to: "/loans", label: "Loan Accounts", icon: Landmark },
      { to: "/payments", label: "Payments", icon: Wallet },
      { to: "/collections", label: "Collections", icon: HandCoins }
    ]
  },
  {
    section: "GN Command Center", items: [
      { to: "/gn/co", label: "Command Center", icon: Rocket, end: true, perm: "gn.co.view" },
      { to: "/gn/co/new", label: "New Applicant", icon: UserPlus, perm: "gn.co.create" },
      { to: "/gn/co/applicants", label: "Applicants", icon: UsersRound, perm: "gn.co.view" },
      { to: "/gn/co/bulk", label: "Bulk Applications", icon: Layers, perm: "gn.bulk.view" },
      { to: "/gn/co/api", label: "API Center", icon: Plug, perm: "gn.api.view" },
      { to: "/gn/co/analytics", label: "Analytics", icon: TrendingUp, perm: "gn.co.view" }
    ]
  },
  {
    section: "Growth Nations — Distribution", items: [
      { to: "/gn", label: "GN Dashboard", icon: Globe2, end: true, perm: "gn.view" },
      { to: "/gn/applications", label: "Loan Applications", icon: GitPullRequest, perm: "gn.applications.view" },
      { to: "/gn/leads", label: "Leads", icon: FileText, perm: "gn.leads.view" },
      { to: "/gn/sanction", label: "Sanction", icon: BadgeCheck, perm: "gn.sanction.view" },
      { to: "/gn/disbursement", label: "Disbursement", icon: Wallet, perm: "gn.disbursement.view" },
      { to: "/gn/cross-selling", label: "Cross Selling", icon: RefreshCw, perm: "gn.applications.view" },
      { to: "/gn/direct-booking", label: "Direct Booking", icon: Zap, perm: "gn.applications.view" },
      { to: "/gn/masters", label: "Masters", icon: Store, perm: "gn.masters.view" },
      { to: "/gn/partners", label: "Team / Partners", icon: Handshake, perm: "gn.masters.view" },
      { to: "/gn/finance", label: "Finance", icon: Coins, perm: "gn.finance.view" },
      { to: "/gn/hr", label: "HR & Workforce", icon: HeartPulse, perm: "gn.hr.view" },
      { to: "/gn/marketing", label: "Marketing", icon: Megaphone, perm: "gn.marketing.view" },
      { to: "/gn/tasks", label: "Tasks", icon: ListTodo, perm: "gn.tasks.view" },
      { to: "/gn/tools", label: "Tools", icon: Calculator, perm: "gn.view" },
      { to: "/gn/utility", label: "Utility", icon: Wrench, perm: "gn.utility.view" },
      { to: "/gn/wallet", label: "Wallet", icon: Landmark, perm: "gn.finance.view" },
      { to: "/gn/apis", label: "Verification APIs", icon: Plug2, perm: "gn.settings.view" },
      { to: "/gn/configuration", label: "Configuration", icon: Settings2, perm: "gn.settings.view" },
      { to: "/gn/roles", label: "Roles & Permissions", icon: ShieldCheck, perm: "gn.settings.view" },
      { to: "/gn/settings", label: "Settings", icon: SlidersHorizontal, perm: "gn.settings.view" },
      { to: "/gn/reports", label: "Reports", icon: BarChart3, perm: "gn.reports.view" }
    ]
  },
  {
    section: "Communication & Support", items: [
      { to: "/gn/inbox", label: "Inbox", icon: Inbox, perm: "gn.inbox.view" },
      { to: "/gn/docs", label: "Documentation", icon: BookOpen, perm: "gn.docs.view" },
      { to: "/gn/help", label: "Help & FAQ", icon: LifeBuoy, perm: "gn.help.view" },
      { to: "/gn/changelog", label: "Change Log", icon: GitCommitHorizontal, perm: "gn.changelog.view" },
      { to: "/gn/recycle-bin", label: "Recycle Bin", icon: Trash2, perm: "gn.trash.view" }
    ]
  },
  {
    section: "Compliance", items: [
      { to: "/compliance", label: "Compliance Center", icon: BadgeCheck },
      { to: "/audit", label: "Audit Trail", icon: ScrollText }
    ]
  },
  {
    section: "Intelligence", items: [
      { to: "/reports", label: "Reports", icon: BarChart3 },
      { to: "/risk", label: "Risk Analytics", icon: Activity },
      { to: "/ai", label: "SNIPER AI", icon: BrainCircuit }
    ]
  },
  {
    section: "Platform", items: [
      { to: "/network", label: "Network & DSA", icon: Building2 },
      { to: "/integrations", label: "Integrations", icon: Plug2 },
      { to: "/admin", label: "Administration", icon: Settings2 }
    ]
  }
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { me, loading: permsLoading } = useGnPerms();
  const gnPerms = useMemo(() => new Set(me?.perms ?? []), [me]);
  const nav = useNavigate();
  const loc = useLocation();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<{ id: number; title: string; body: string; created_at: string; read: number }[]>([]);
  const [unread, setUnread] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any>({ customers: [], leads: [], applications: [], loans: [] });
  const searchRef = useRef<HTMLInputElement>(null);

  const loadNotifs = () => api<{ rows: any[]; unread: number }>("/notifications").then((r) => { setNotifs(r.rows); setUnread(r.unread); });
  useEffect(() => { loadNotifs(); const t = setInterval(loadNotifs, 15000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === "Escape") { setSearchOpen(false); setNotifOpen(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (!searchOpen) { setQ(""); setResults({}); return; }
    setTimeout(() => searchRef.current?.focus(), 60);
  }, [searchOpen]);

  const runSearch = async (term: string) => {
    setQ(term);
    if (term.length < 2) { setResults({}); return; }
    const r = await api("/search?q=" + encodeURIComponent(term));
    setResults(r);
  };

  const go = (path: string) => {
    setSearchOpen(false);
    nav(path);
  };

  // Channel roles (DSA / field / telecaller) get their portal entry in CRM
  const navGroups = useMemo(() => {
    let groups = NAV;
    if (["dsa", "field_executive", "telecaller", "sales_manager"].includes(user?.role || "")) {
      groups = groups.map((g) => (g.section === "CRM"
        ? { ...g, items: [...g.items, { to: "/channel", label: "My Channel Portal", icon: Building2 }] }
        : g));
    }
    // Role-based dashboard: hide GN nav items the role's permission grid does not grant.
    if (!permsLoading && gnPerms.size > 0) {
      groups = groups.map((g) => {
        if (g.section !== "Growth Nations — Distribution") return g;
        const items = g.items.filter((i) => !i.perm || matchesPerm(gnPerms, i.perm));
        return { ...g, items };
      }).filter((g) => g.section !== "Growth Nations — Distribution" || g.items.length > 0);
    }
    return groups;
  }, [user?.role, gnPerms, permsLoading]);

  const current = useMemo(() => {
    for (const g of navGroups) {
      const item = g.items.find((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));
      if (item) return { ...item, section: g.section };
    }
    return null;
  }, [loc.pathname, navGroups]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[228px] shrink-0 bg-white border-r border-zinc-200/80 flex flex-col">
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-zinc-100">
          <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center text-white font-bold text-[13px] tracking-tight shadow-sm">N</div>
          <div>
            <div className="text-[14px] font-bold tracking-tight text-zinc-900 leading-none">SNIPER</div>
            <div className="text-[9.5px] font-medium text-zinc-400 uppercase tracking-[0.08em] mt-0.5">Lending OS</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {navGroups.map((group) => (
            <div key={group.section} className="mb-4">
              <div className="px-2 mb-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-zinc-400">{group.section}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[12.5px] font-medium mb-0.5 transition-colors ${isActive ? "bg-brand-50 text-brand-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`
                  }
                >
                  <item.icon size={15} strokeWidth={1.8} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-zinc-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center text-[12px] font-semibold">
              {user?.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-zinc-800 truncate">{user?.name}</div>
              <div className="text-[10.5px] text-zinc-400 truncate">{ROLE_LABELS[user?.role || ""]}</div>
            </div>
            <button className="text-zinc-400 hover:text-rose-600 cursor-pointer" onClick={logout} title="Sign out"><LogOut size={14} /></button>
          </div>
          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-100 px-2 py-1">
            <AlertTriangle size={10} className="text-amber-600" />
            <span className="text-[9.5px] font-semibold text-amber-700 uppercase tracking-wide">Demo Environment</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-white/80 backdrop-blur border-b border-zinc-200/80 flex items-center gap-3 px-5">
          <div className="text-[12px] text-zinc-400 font-medium">{current?.section ?? ""} <ChevronRight size={11} className="inline -mt-0.5" /> <span className="text-zinc-700">{current?.label ?? ""}</span></div>
          <div className="flex-1" />
          <button onClick={() => setSearchOpen(true)} className="flex items-center gap-2 text-[12px] text-zinc-400 bg-zinc-50 border border-zinc-200 rounded-md px-2.5 py-1.5 hover:border-zinc-300 cursor-pointer">
            <Search size={13} />
            <span className="hidden md:inline">Search SNIPER…</span>
            <span className="hidden md:flex items-center gap-0.5 text-[10px] text-zinc-400"><span className="bg-white border border-zinc-200 rounded px-1 py-px">⌘</span><span className="bg-white border border-zinc-200 rounded px-1 py-px">K</span></span>
          </button>
          <div className="relative">
            <button className="relative p-2 rounded-md text-zinc-500 hover:bg-zinc-100 cursor-pointer" onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen) loadNotifs(); }}>
              <Bell size={16} />
              {unread > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500 border border-white" />}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-10 w-80 card shadow-xl z-40 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-zinc-100 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-zinc-800">Notifications</span>
                  <button className="text-[10.5px] text-brand-600 font-medium cursor-pointer" onClick={async () => { await api("/notifications/read", { method: "POST" }); setUnread(0); }}>Mark all read</button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifs.slice(0, 15).map((n) => (
                    <div key={n.id} className={`px-3 py-2.5 border-b border-zinc-50 ${n.read ? "" : "bg-brand-50/40"}`}>
                      <div className="text-[12px] font-medium text-zinc-800">{n.title}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{n.body}</div>
                      <div className="text-[10px] text-zinc-400 mt-1">{timeAgo(n.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="text-[11px] text-zinc-400 border-l border-zinc-200 pl-3 hidden lg:block">
            {user?.email}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5">
          {children}
          <footer className="mt-8 pt-4 border-t border-zinc-200/60 text-[10.5px] text-zinc-400 flex items-center justify-between">
            <span>SNIPER v0.1 · India-focused compliance-ready architecture · Production deployment requires applicable regulatory, legal, security and integration validation.</span>
            <span className="hidden sm:block">All data shown is synthetic demo data</span>
          </footer>
        </main>
      </div>

      {/* Global search */}
      {searchOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-zinc-950/30 backdrop-blur-[2px]" onClick={() => setSearchOpen(false)} />
          <div className="relative max-w-xl mx-auto mt-[14vh] card shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-100">
              <Search size={16} className="text-zinc-400" />
              <input
                ref={searchRef}
                className="flex-1 text-[14px] outline-none placeholder:text-zinc-400"
                placeholder="Search customers, leads, applications, loans…"
                value={q}
                onChange={(e) => runSearch(e.target.value)}
              />
              <span className="text-[10px] text-zinc-400 bg-zinc-100 rounded px-1.5 py-0.5">ESC</span>
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {q.length < 2 && <div className="py-8 text-center text-[12px] text-zinc-400">Type at least 2 characters to search the platform</div>}
              {q.length >= 2 && (
                <div className="space-y-3">
                  <SearchGroup title={`Customers (${results.customers?.length ?? 0})`} items={(results.customers || []).map((c: any) => ({ id: c.id, label: c.name, sub: `${c.customer_no} · ${c.city || ""}`, path: `/customers/${c.id}` }))} onPick={go} />
                  <SearchGroup title={`Leads (${results.leads?.length ?? 0})`} items={(results.leads || []).map((l: any) => ({ id: l.id, label: l.name, sub: `${l.lead_no} · ${l.status}`, path: `/leads/${l.id}` }))} onPick={go} />
                  <SearchGroup title={`Applications (${results.applications?.length ?? 0})`} items={(results.applications || []).map((a: any) => ({ id: a.id, label: a.application_no, sub: `${a.stage} · ${a.status}`, path: `/applications/${a.id}` }))} onPick={go} />
                  <SearchGroup title={`Loans (${results.loans?.length ?? 0})`} items={(results.loans || []).map((l: any) => ({ id: l.id, label: l.loan_no, sub: `${l.status} · customer #${l.customer_id}`, path: `/loans/${l.id}` }))} onPick={go} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchGroup({ title, items, onPick }: { title: string; items: { id: number; label: string; sub: string; path: string }[]; onPick: (p: string) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</div>
      {items.map((it) => (
        <button key={it.id} className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-zinc-50 text-left cursor-pointer" onClick={() => onPick(it.path)}>
          <div>
            <div className="text-[13px] font-medium text-zinc-800">{it.label}</div>
            <div className="text-[11px] text-zinc-500">{it.sub}</div>
          </div>
          <UserCircle2 size={14} className="text-zinc-300" />
        </button>
      ))}
    </div>
  );
}
