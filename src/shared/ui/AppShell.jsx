import { Children, cloneElement, isValidElement, useState } from "react";

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
    <nav className={`app-tabs ${collapsed ? "app-tabs--collapsed" : ""} ${className}`.trim()} aria-label={label}>
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
      {buttons.map((button, index) => cloneElement(button, {
        "aria-current": index === selected ? "page" : undefined,
        onClick: (event) => openView(index, event),
      }))}
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
