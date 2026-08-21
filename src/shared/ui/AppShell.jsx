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
  return <nav className={`app-tabs ${className}`.trim()} aria-label={label}>{children}</nav>;
}

export function SourceStrip({ className = "", tone = "quiet", children }) {
  return (
    <div className={`app-source-strip app-source-strip--${tone} ${className}`.trim()}>
      {children}
    </div>
  );
}
