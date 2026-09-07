import { Children, cloneElement, isValidElement } from "react";

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
    <nav className={`app-tabs ${className}`.trim()} aria-label={label}>
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
