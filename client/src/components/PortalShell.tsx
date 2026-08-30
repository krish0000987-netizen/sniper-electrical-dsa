import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, FilePlus2, ListChecks, Landmark, FileText, LifeBuoy, LogOut, ChevronRight, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";

const NAV = [
  { to: "/portal", label: "My Dashboard", icon: LayoutDashboard, end: true },
  { to: "/portal/apply", label: "Apply for a Loan", icon: FilePlus2 },
  { to: "/portal/applications", label: "My Applications", icon: ListChecks },
  { to: "/portal/loans", label: "My Loans", icon: Landmark },
  { to: "/portal/documents", label: "My Documents", icon: FileText },
  { to: "/portal/support", label: "Support", icon: LifeBuoy }
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f6f7]">
      <aside className="w-[230px] shrink-0 bg-white border-r border-zinc-200/80 flex flex-col">
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-zinc-100">
          <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center text-white font-bold text-[13px]">N</div>
          <div>
            <div className="text-[14px] font-bold tracking-tight text-zinc-900 leading-none">Customer Portal</div>
            <div className="text-[9.5px] font-medium text-zinc-400 uppercase tracking-[0.08em] mt-0.5">SNIPER Lending OS</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {NAV.map((item) => (
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
        </nav>
        <div className="p-3 border-t border-zinc-100 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center text-[12px] font-semibold">
              {user?.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-zinc-800 truncate">{user?.name}</div>
              <div className="text-[10.5px] text-zinc-400 truncate">{user?.email}</div>
            </div>
            <button className="text-zinc-400 hover:text-rose-600 cursor-pointer" onClick={logout} title="Sign out"><LogOut size={14} /></button>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-100 px-2 py-1">
            <ShieldCheck size={10} className="text-amber-600" />
            <span className="text-[9.5px] font-semibold text-amber-700 uppercase tracking-wide">Demo Environment</span>
          </div>
          <button className="w-full text-[11px] text-zinc-400 hover:text-zinc-700 text-left cursor-pointer" onClick={() => nav("/login")}>
            <ChevronRight size={10} className="inline -mt-0.5 mr-0.5" /> Staff sign-in
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-white/80 backdrop-blur border-b border-zinc-200/80 flex items-center px-5">
          <div className="text-[12px] text-zinc-400 font-medium">Customer Portal <ChevronRight size={11} className="inline -mt-0.5" /> <span className="text-zinc-700">My Account</span></div>
          <div className="flex-1" />
          <span className="text-[11px] text-zinc-400">Payments shown here are sandbox / demo only</span>
        </header>
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
