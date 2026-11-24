"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Wordmark, Logo } from "@/components/Brand";
import { NAV } from "@/lib/nav";
import { logout, setCompany, setFy } from "@/actions/auth";
import AiWidget from "@/components/ai/AiWidget";

type Props = {
  children: ReactNode; user: { name: string; email: string }; orgName: string; role: string;
  companies: { id: string; name: string }[]; companyId: string; fys: { id: string; label: string; status: string }[]; fyId: string; unread: number;
};
type Hit = { href: string; label: string; sub?: string };
type NotificationItem = { id: string; title: string; body: string; level: string; href: string | null; readAt: string | null; createdAt: string };
const ACCENTS = ["#10b981", "#14b8a6", "#38bdf8", "#a78bfa", "#f59e0b", "#fb7185"];

export default function AppShell({ children, user, orgName, role, companies, companyId, fys, fyId, unread }: Props) {
  const path = usePathname(); const router = useRouter();
  const [collapsed, setCollapsed] = useState(true);
  const [drawerForPath, setDrawerForPath] = useState<string | null>(null);
  const drawer = drawerForPath === path;
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerToggleRef = useRef<HTMLButtonElement>(null);
  const [palette, setPalette] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [help, setHelp] = useState(false);
  const [bell, setBell] = useState(false);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [notificationItems, setNotificationItems] = useState<NotificationItem[] | null>(null);
  const [pending, start] = useTransition();
  const loadNotifications = useCallback(async () => {
    const response = await fetch("/api/notifications");
    setNotificationItems(response.ok ? await response.json() : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize persisted browser preferences after hydration.
    setTheme(document.documentElement.getAttribute("data-theme") ?? "dark");
    const savedCollapsed = localStorage.getItem("fv-collapsed");
    setCollapsed(savedCollapsed === null || savedCollapsed === "1");
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const panel = drawerRef.current;
    const trigger = drawerToggleRef.current;
    if (!panel) return;
    const getFocusable = () => [...panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    getFocusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerForPath(null);
        trigger?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [drawer]);

  const toggleTheme = () => { const t = theme === "dark" ? "light" : "dark"; setTheme(t); document.documentElement.setAttribute("data-theme", t); localStorage.setItem("fv-theme", t); };
  const setAccent = (a: string) => { document.documentElement.style.setProperty("--accent", a); localStorage.setItem("fv-accent", a); };
  const changeCompany = (id: string) => { setDrawerForPath(null); start(() => setCompany(id)); };
  const changeFy = (id: string) => { setDrawerForPath(null); start(() => setFy(id)); };

  // Keyboard shortcuts: Ctrl/Cmd+K palette, g+key navigation, ? help
  const gRef = useRef(false);
  useEffect(() => {
    const map: Record<string, string> = { d: "/dashboard", a: "/accounting", t: "/tax", m: "/markets", p: "/portfolio", i: "/ai", c: "/charts", f: "/fpna", b: "/banking", s: "/settings" };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "Escape") { setPalette(false); setHelp(false); setBell(false); setMenu(false); }
      if (e.key === "?") setHelp((h) => !h);
      if (e.key === "/") { e.preventDefault(); setPalette(true); }
      if (gRef.current && map[e.key]) { router.push(map[e.key]); gRef.current = false; return; }
      gRef.current = e.key === "g"; if (gRef.current) setTimeout(() => (gRef.current = false), 1200);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const crumbs = useMemo(() => {
    const parts = path.split("/").filter(Boolean);
    return parts.map((p, i) => ({ label: p.replace(/-/g, " "), href: "/" + parts.slice(0, i + 1).join("/") }));
  }, [path]);

  const sidebar = (compact: boolean, inDrawer = false) => (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b border-line px-3">
        <Link href="/dashboard" aria-label="FINVANTA home">
          {inDrawer ? <Wordmark /> : compact ? <Logo /> : <><span className="hidden lg:inline"><Wordmark /></span><span className="lg:hidden"><Logo /></span></>}
        </Link>
        {!inDrawer && <button className="btn btn-sm hidden lg:inline-flex" aria-label={compact ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!compact} onClick={() => { setCollapsed(!collapsed); localStorage.setItem("fv-collapsed", collapsed ? "0" : "1"); }}>{compact ? "»" : "«"}</button>}
      </div>
      {inDrawer && <div className="space-y-2 border-b border-line px-3 py-3">
          <select aria-label="Company" className="inp w-full !py-1 text-xs" value={companyId} disabled={pending} onChange={(e) => changeCompany(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Financial year" className="inp w-full !py-1 text-xs" value={fyId} disabled={pending} onChange={(e) => changeFy(e.target.value)}>
            {fys.map((f) => <option key={f.id} value={f.id}>{f.label}{f.status === "closed" ? " 🔒" : ""}</option>)}
          </select>
        </div>}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-4">
            {!compact && <div className={`mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted ${inDrawer ? "" : "hidden lg:block"}`}>{g.group}</div>}
            {g.items.map((it) => {
              const active = path === it.href || path.startsWith(it.href + "/");
              return (
                <Link key={it.href} href={it.href} title={it.label} aria-label={it.label} aria-current={active ? "page" : undefined}
                  className={`mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${active ? "bg-accent/12 font-medium text-accent" : "text-muted hover:bg-panel2 hover:text-fg"}`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[10px] font-bold ${active ? "border-accent/50" : "border-line"}`}>{it.label.slice(0, 2).toUpperCase()}</span>
                  {!compact && <span className={`truncate ${inDrawer ? "" : "hidden lg:inline"}`}>{it.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      {!compact && <div className={`border-t border-line p-3 text-[10px] leading-snug text-muted ${inDrawer ? "" : "hidden lg:block"}`}>Calculations are decision support. Statutory filings must be submitted via official portals.</div>}
    </nav>
  );

  return (
    <div className={`min-h-screen min-w-0 md:grid md:grid-cols-[64px_minmax(0,1fr)] ${collapsed ? "lg:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]"}`}>
      <a href="#main" className="sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:not-sr-only focus:rounded-md focus:bg-panel focus:px-3 focus:py-2">Skip to main content</a>
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-panel md:block">{sidebar(collapsed)}</aside>
      {drawer && (
        <div ref={drawerRef} id="mobile-navigation" className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation" tabIndex={-1}>
          <button type="button" tabIndex={-1} className="absolute inset-0 h-full w-full bg-black/60" aria-label="Close navigation" onClick={() => setDrawerForPath(null)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-panel">{sidebar(false, true)}</aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur lg:px-5">
          <button ref={drawerToggleRef} className="btn btn-sm md:hidden" aria-label="Open navigation" aria-controls={drawer ? "mobile-navigation" : undefined} aria-expanded={drawer} onClick={() => setDrawerForPath(path)}>☰</button>
          <div className="hidden items-center gap-2 md:flex">
            <select aria-label="Company" className="inp !w-auto max-w-44 !py-1 text-xs" value={companyId} disabled={pending} onChange={(e) => changeCompany(e.target.value)}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select aria-label="Financial year" className="inp !w-auto !py-1 text-xs" value={fyId} disabled={pending} onChange={(e) => changeFy(e.target.value)}>
              {fys.map((f) => <option key={f.id} value={f.id}>{f.label}{f.status === "closed" ? " 🔒" : ""}</option>)}
            </select>
          </div>
          <form role="search" onSubmit={(event) => { event.preventDefault(); setPalette(true); }} className="mx-auto hidden max-w-md flex-1 items-center justify-between rounded-lg border border-line bg-panel px-3 py-1.5 text-xs text-muted focus-within:border-accent lg:flex">
            <input type="search" aria-label="Search vouchers, parties, accounts, and pages" className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-muted" placeholder="Search vouchers, parties, accounts, pages…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
            <kbd className="ml-2 shrink-0 rounded border border-line px-1.5 text-[10px]">Ctrl K</kbd>
          </form>
          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <button className="btn btn-sm lg:hidden" onClick={() => setPalette(true)} aria-label="Search">⌕</button>
            <div className="relative">
              <button className="btn btn-sm" aria-label={`Notifications (${unread} unread)`} aria-expanded={bell} onClick={() => { const opening = !bell; setBell(opening); setMenu(false); if (opening) void loadNotifications(); }}>
                🔔{unread > 0 && <span className="rounded-full bg-down px-1.5 text-[10px] font-bold text-white">{unread}</span>}
              </button>
              {bell && <Notifications items={notificationItems} onRefresh={loadNotifications} onClose={() => setBell(false)} />}
            </div>
            <button className="btn btn-sm" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? "☾" : "☀"}</button>
            <div className="relative">
              <button className="btn btn-sm" aria-label={`Account menu for ${user.name}`} aria-expanded={menu} onClick={() => { setMenu(!menu); setBell(false); }}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-accentfg">{user.name.slice(0, 1).toUpperCase()}</span>
              </button>
              {menu && (
                <div className="absolute right-0 top-9 z-50 w-64 rounded-xl border border-line bg-panel p-3 text-xs shadow-2xl">
                  <div className="font-semibold">{user.name}</div>
                  <div className="text-muted">{user.email}</div>
                  <div className="mt-1 text-muted">{orgName} · <span className="uppercase">{role}</span></div>
                  <div className="my-3 flex gap-1.5" role="group" aria-label="Accent colour">
                    {ACCENTS.map((a) => <button key={a} aria-label={`Accent ${a}`} onClick={() => setAccent(a)} className="h-5 w-5 rounded-full border border-line" style={{ background: a }} />)}
                  </div>
                  <Link href="/settings" className="block rounded px-2 py-1 hover:bg-panel2">Settings & security</Link>
                  <Link href="/usage" className="block rounded px-2 py-1 hover:bg-panel2">Plan & AI usage</Link>
                  <button className="block w-full rounded px-2 py-1 text-left hover:bg-panel2" onClick={() => { setHelp(true); setMenu(false); }}>Keyboard shortcuts</button>
                  <form action={logout}><button className="mt-1 block w-full rounded px-2 py-1 text-left text-down hover:bg-panel2">Sign out</button></form>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="border-b border-line/60 px-4 py-1.5 text-[11px] capitalize text-muted lg:px-5" aria-label="Breadcrumb">
          <Link href="/dashboard" className="hover:text-fg">FINVANTA</Link>
          {crumbs.map((c) => <span key={c.href}> / <Link href={c.href} className="hover:text-fg">{c.label}</Link></span>)}
        </div>
        <main id="main" className="min-w-0 p-4 lg:p-5">{children}</main>
        <footer className="border-t border-line px-4 py-3 text-center text-[10px] text-muted">FINVANTA · Created by Vinod Kumar</footer>
      </div>
      <AiWidget />
      {palette && <Palette initialQuery={searchQuery} onClose={() => setPalette(false)} />}
      {help && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setHelp(false)}>
          <div className="w-full max-w-md rounded-xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-sm font-semibold">Keyboard shortcuts</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {[["Ctrl/⌘ + K  or  /", "Command palette & search"], ["g then d", "Dashboard"], ["g then a", "Accounting"], ["g then t", "Tax"], ["g then m", "Markets"], ["g then c", "Charts"], ["g then p", "Portfolios"], ["g then f", "FP&A"], ["g then b", "Banking"], ["g then i", "AI assistant"], ["g then s", "Settings"], ["?", "Toggle this help"], ["Esc", "Close dialogs"]].map(([k, v]) => (
                <div key={k} className="contents"><dt><kbd className="rounded border border-line px-1.5 py-0.5 text-[11px]">{k}</kbd></dt><dd className="text-muted">{v}</dd></div>
              ))}
            </dl>
            <button className="btn mt-4" onClick={() => setHelp(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Notifications({ items, onRefresh, onClose }: { items: NotificationItem[] | null; onRefresh: () => Promise<void>; onClose: () => void }) {
  return (
    <div className="absolute right-0 top-9 z-50 w-80 rounded-xl border border-line bg-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold">Notifications
        <span className="flex gap-1"><button className="btn btn-sm" onClick={async () => { await fetch("/api/notifications", { method: "POST" }); await onRefresh(); }}>Mark read</button><button className="btn btn-sm" onClick={onClose}>✕</button></span>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {items === null && <div className="p-3"><div className="skeleton h-10" /></div>}
        {items?.length === 0 && <div className="p-4 text-center text-xs text-muted">No notifications yet. KPI alerts appear here when thresholds are breached.</div>}
        {items?.map((n) => (
          <Link key={n.id} href={n.href ?? "#"} onClick={onClose} className={`block border-b border-line/60 px-3 py-2 text-xs hover:bg-panel2 ${n.readAt ? "opacity-60" : ""}`}>
            <div className={`font-semibold ${n.level === "critical" ? "text-down" : n.level === "warning" ? "text-warn" : ""}`}>{n.title}</div>
            <div className="text-muted">{n.body}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Palette({ onClose, initialQuery = "" }: { onClose: () => void; initialQuery?: string }) {
  const router = useRouter(); const [q, setQ] = useState(initialQuery); const [remote, setRemote] = useState<{ query: string; items: Hit[]; error?: string } | null>(null); const [sel, setSel] = useState(0);
  const query = q.trim();
  const filteredPages = useMemo(() => {
    const t = q.toLowerCase();
    return NAV.flatMap((g) => g.items.filter((i) => !t || `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(t)).map((i) => ({ href: i.href, label: i.label, sub: `Page · ${g.group}` })));
  }, [q]);
  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error(`Search failed (${response.status}).`);
        const items: Hit[] = await response.json();
        if (!cancelled) setRemote({ query, items });
      } catch (error) {
        if (!cancelled) setRemote({ query, items: [], error: error instanceof Error ? error.message : "Search failed." });
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);
  const hits = remote?.query === query ? remote.items : [];
  const all = [...filteredPages, ...hits];
  const go = (h: Hit) => { router.push(h.href); onClose(); };
  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/60 p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input autoFocus className="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none" placeholder="Type to search pages, vouchers, parties, accounts, documents…" value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, all.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); } if (e.key === "Enter" && all[sel]) go(all[sel]); if (e.key === "Escape") onClose(); }} />
        {remote?.query === query && remote.error && <p role="status" className="border-b border-line px-4 py-2 text-xs text-down">{remote.error}</p>}
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {all.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted">No results.</li>}
          {all.map((h, i) => (
            <li key={h.href + h.label + i} role="option" aria-selected={i === sel}>
              <button className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${i === sel ? "bg-accent/12" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
                <span>{h.label}</span><span className="text-[11px] text-muted">{h.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
