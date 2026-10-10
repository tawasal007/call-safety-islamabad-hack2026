"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight, FileWarning, History, Home, MailWarning, Menu, Phone, Shield, X } from "lucide-react";

const tabs = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/call-logs", label: "Call history", icon: History },
  { href: "/crime-reports", label: "Crime reports", icon: FileWarning },
  { href: "/sos-email", label: "SOS email", icon: MailWarning },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 980px)");
    const sync = () => setCollapsed(compact.matches);
    sync();
    compact.addEventListener("change", sync);
    return () => compact.removeEventListener("change", sync);
  }, []);
  const inCall = pathname.startsWith("/call/");
  const current = inCall ? "Your call" : tabs.find((tab) => tab.href === pathname)?.label ?? "Call Safety";
  return <div className={`application${collapsed ? " sidebar-collapsed" : ""}`}>
    <a className="skip-link" href="#app-content">Skip to content</a>
    <aside className="app-sidebar" aria-label="Main navigation">
      <Link href="/" className="sidebar-brand" aria-label="Call Safety home"><span className="wordmark-mark"><Shield size={20} /></span><span className="sidebar-label">Call Safety<span className="brand-caption">A little more peace of mind.</span></span></Link>
      <button className="menu-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand menu" : "Collapse menu"} aria-expanded={!collapsed} aria-controls="main-tabs"><Menu size={20} /><span className="sidebar-label">Menu</span><span className="menu-chevron sidebar-label">{collapsed ? <ChevronRight size={14} /> : <X size={14} />}</span></button>
      <p className="sidebar-section sidebar-label">WORKSPACE</p>
      <nav id="main-tabs" className="sidebar-tabs">{tabs.map(({ href, label, icon: Icon }) => {
        const active = href === "/calls" ? pathname === href || inCall : pathname === href;
        return <Link key={href} href={href} className={`sidebar-tab${active ? " is-current" : ""}`} aria-label={label} aria-current={active ? "page" : undefined} title={label} onClick={() => { if (window.matchMedia("(max-width: 980px)").matches) setCollapsed(true); }}><Icon size={19} /><span className="sidebar-label">{label}</span>{active && <i className="sidebar-label" />}</Link>;
      })}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note sidebar-label"><Shield size={19} /><strong>Stay in the conversation.</strong><p>Keep an eye on what matters, with live captions and safety warnings.</p></div><div className="sidebar-signature"><span className="profile-avatar">CS</span><span className="sidebar-label"><strong>Your workspace</strong><small>Browser audio calls</small></span></div></div>
    </aside>
    <div className="application-body">
      <header className="workspace-topbar"><div className="workspace-breadcrumb"><Shield size={16} /><span>Call Safety</span><ChevronRight size={14} /><strong>{current}</strong></div><div className="header-tools">{!inCall && pathname !== "/calls" && <Link href="/calls" className="topbar-call"><Phone size={15} /><span>Make a call</span><ArrowUpRight size={14} /></Link>}</div></header>
      <div id="app-content" className="application-content" tabIndex={-1}>{children}</div>
    </div>
  </div>;
}
