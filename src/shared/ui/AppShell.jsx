import { Children, cloneElement, isValidElement, useState, useRef } from "react";

import { createJsonStore } from "../storage/jsonStore.js";

const sidebarStore = createJsonStore({ feature: "sidebar-collapsed" });

export function AppHeader({ className = "", brandClassName = "", controlsClassName = "", subtitle, children }) {
  return (
    <header className={`app-header ${className}`.trim()}>
      <div className={`app-brand ${brandClassName}`.trim()}>
        <h1><span>Vaal</span> Street</h1>
        <p className="app-brand-subtitle">{subtitle}</p>
      </div>
      <div className={`app-header-controls ${controlsClassName}`.trim()}>{children}</div>
    </header>
  );
}

export function AppTabs({ className = "", label = "Views", children }) {
  const navRef = useRef(null);
  const [collapsed, setCollapsed] = useState(() => sidebarStore.load(false) === true);
  const toggleSidebar = () => setCollapsed((value) => { sidebarStore.save(!value); return !value; });
  const buttons = Children.toArray(children).filter(isValidElement);
  const selected = buttons.findIndex((button) => button.props.className?.split(" ").includes("on"));
  const buttonText = (content) => Children.toArray(content).map((child) =>
    isValidElement(child) ? buttonText(child.props.children) : child
  ).join("");
  const openView = (index, event) => {
    buttons[index]?.props.onClick?.(event);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <nav ref={navRef} className={`app-tabs ${collapsed ? "app-tabs--collapsed" : ""} ${className}`.trim()} aria-label={label}>
      <div className="app-sidebar-heading">
        <span>Workspace</span>
        <button type="button" className="app-sidebar-toggle" onClick={toggleSidebar} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d={collapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"}/></svg>
        </button>
      </div>
      <label className="app-mobile-nav">
        <span>Explore</span>
        <select value={selected < 0 ? "" : selected} onChange={(event) => openView(Number(event.target.value), event)}>
          {buttons.map((button, index) => <option key={button.key} value={index}>{buttonText(button.props.children)}</option>)}
        </select>
      </label>
      {buttons.map((button, index) => {
        const name = button.props["aria-label"] || buttonText(button.props.children);
        const initials = name.trim().split(/\s+/).map((word) => word[0]).join("").toUpperCase();
        return cloneElement(button, {
          "aria-current": index === selected ? "page" : undefined,
          "aria-label": name,
          title: name,
          onKeyDown: (event) => {
            button.props.onKeyDown?.(event);
            if (event.defaultPrevented || !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
            const links = [...navRef.current.querySelectorAll(":scope > button:not(:disabled)")];
            const current = links.indexOf(event.currentTarget);
            if (current < 0) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1
              : (current + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + links.length) % links.length;
            links[next]?.focus();
          },
          onClick: (event) => openView(index, event),
          children: <><span className="app-tab-label">{button.props.children}</span><span className="app-tab-initials" aria-hidden="true">{initials}</span></>,
        });
      })}
    </nav>
  );
}

export function SourceStrip({ className = "", tone = "quiet", children }) {
  return (
    <div className={`app-source-strip app-source-strip--${tone} ${className}`.trim()}>
      {children}
    </div>
  );
}

export function LoadingPanel({ label = "Loading market data…" }) {
  return <section className="app-loading-panel" role="status" aria-live="polite" aria-busy="true">
    <div className="app-loading-label"><span aria-hidden="true" />{label}</div>
    <div className="app-loading-preview" aria-hidden="true">
      {[0, 1, 2].map((item) => <div key={item}><i /><i /><i /></div>)}
    </div>
  </section>;
}
