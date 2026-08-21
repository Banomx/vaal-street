import { useEffect, useMemo, useRef, useState } from "react";
import { groupMarkets, marketCategory, marketSubcategory, MARKET_CATEGORIES, MARKET_SUBCATEGORIES } from "../features/pricing/marketCategories.js";

export default function MarketBrowser({ names, entries = {}, selectedName, onSelect, preferredName = "Divine Orb", sticky = false }) {
  const groups = useMemo(() => groupMarkets(names, entries), [entries, names]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [subcategory, setSubcategory] = useState("all");
  const [expandedCategory, setExpandedCategory] = useState(null);
  const internalSelection = useRef("");
  const externalSelection = useRef("");

  const visibleNames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const categoryNames = subcategory === "all"
      ? groups[category] || groups.all
      : groups.subgroups[category]?.[subcategory] || [];
    return needle ? categoryNames.filter((name) => name.toLowerCase().includes(needle)) : categoryNames;
  }, [category, groups, query, subcategory]);

  useEffect(() => {
    if (!selectedName || !names.includes(selectedName)) return;
    if (internalSelection.current === selectedName) {
      internalSelection.current = "";
      return;
    }
    const selectedCategory = marketCategory(selectedName, entries[selectedName] || {});
    const selectedSubcategory = marketSubcategory(selectedCategory, selectedName, entries[selectedName] || {});
    externalSelection.current = selectedName;
    setQuery("");
    setCategory(selectedCategory);
    setSubcategory(MARKET_SUBCATEGORIES[selectedCategory] ? selectedSubcategory : "all");
    setExpandedCategory(selectedCategory);
  }, [entries, names, selectedName]);

  useEffect(() => {
    if (!visibleNames.length) return;
    if (externalSelection.current === selectedName) {
      if (visibleNames.includes(selectedName)) externalSelection.current = "";
      return;
    }
    if (!visibleNames.includes(selectedName)) selectName(visibleNames.find((name) => name === preferredName) || visibleNames[0]);
  }, [onSelect, preferredName, selectedName, visibleNames]);

  function selectName(name) {
    internalSelection.current = name;
    onSelect(name);
  }

  function selectCategory(id) {
    if (category === id) {
      const collapsing = expandedCategory === id;
      setExpandedCategory(collapsing ? null : id);
      if (collapsing) setSubcategory("all");
      return;
    }
    setCategory(id);
    setSubcategory("all");
    setExpandedCategory(id);
  }

  return <aside className={`p2mb-browser ${sticky ? "sticky" : ""}`} aria-label="Market browser">
    <style>{css}</style>
    <label className="p2mb-search"><span>Find an item</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search market names" /></label>
    <nav className="p2mb-categories" aria-label="Item categories">
      {MARKET_CATEGORIES.filter(([id]) => id === "all" || groups[id].length).map(([id, label]) => <div className="p2mb-category-branch" key={id}>
        <button type="button" aria-pressed={category === id} aria-expanded={MARKET_SUBCATEGORIES[id] ? expandedCategory === id : undefined} title={label} className={category === id ? "on" : ""} onClick={() => selectCategory(id)}>
          <span>{label}</span><em>{groups[id].length}</em>
        </button>
        {expandedCategory === id && MARKET_SUBCATEGORIES[id] && <div className="p2mb-subcategories" aria-label={`${label} subcategories`}>
          {MARKET_SUBCATEGORIES[id].filter(([childId]) => groups.subgroups[id][childId].length).map(([childId, childLabel]) => <button type="button" aria-pressed={subcategory === childId} title={childLabel} key={childId} className={subcategory === childId ? "on" : ""} onClick={() => setSubcategory(childId)}>
            <span>{childLabel}</span><em>{groups.subgroups[id][childId].length}</em>
          </button>)}
        </div>}
      </div>)}
    </nav>
    <div className="p2mb-results">
      <header><span>Items</span><em>{visibleNames.length}</em></header>
      <div className="p2mb-items" role="listbox" aria-label="Items in selected category">
        {visibleNames.map((name) => <button type="button" role="option" aria-selected={selectedName === name} title={name} key={name} className={selectedName === name ? "on" : ""} onClick={() => selectName(name)}>{name}</button>)}
        {!visibleNames.length && <p>No items match this search.</p>}
      </div>
    </div>
  </aside>;
}

const css = `
.p2mb-browser{display:grid;grid-template-columns:minmax(138px,.85fr) minmax(0,1.15fr);grid-template-rows:auto minmax(0,1fr);align-items:stretch;gap:12px;min-width:0;height:548px;max-height:calc(100vh - 24px);padding:14px;border:1px solid #4a2b20;border-radius:8px;background:#110c0a}
.p2mb-browser.sticky{position:sticky;top:12px}
.p2mb-search{display:grid;grid-column:1/-1;gap:5px}
.p2mb-search>span,.p2mb-results header>span{color:#bd6846;font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.p2mb-search input{box-sizing:border-box;width:100%;min-width:0;padding:9px;border:1px solid #513022;border-radius:5px;background:#0d0908;color:#e1ccc2}
.p2mb-categories,.p2mb-category-branch,.p2mb-subcategories{display:grid;align-content:start;gap:3px;min-width:0}
.p2mb-categories{min-height:0;overflow:auto;padding-right:2px}
.p2mb-categories button{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;padding:7px 9px;border:1px solid transparent;border-radius:4px;background:transparent;color:#ae9387;cursor:pointer;text-align:left}
.p2mb-categories button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p2mb-categories button:hover{background:#1a100d}
.p2mb-categories>.p2mb-category-branch>button.on{border-color:#713a26;background:#28150f;color:#f0b49b}
.p2mb-categories em,.p2mb-results header em{flex:0 0 auto;color:#745f56;font-size:10px;font-style:normal}
.p2mb-categories button.on em{color:#bd7658}
.p2mb-subcategories{margin:1px 0 3px 10px;padding-left:7px;border-left:1px solid #3c271e}
.p2mb-subcategories button{padding:5px 7px;color:#846f66;font-size:11px}
.p2mb-subcategories button.on{background:#1e120e;color:#e5a78d}
.p2mb-results{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0}
.p2mb-results header{display:flex;align-items:center;justify-content:space-between;min-height:29px;padding:0 8px;border-bottom:1px solid #302019}
.p2mb-items{display:block;min-width:0;min-height:0;overflow:auto;padding-top:8px}
.p2mb-items button{display:block;box-sizing:border-box;width:100%;min-width:0;overflow:hidden;padding:7px 8px;border:0;border-left:2px solid transparent;background:transparent;color:#a58c81;cursor:pointer;font-size:11.5px;line-height:1.3;text-align:left;text-overflow:ellipsis;white-space:nowrap}
.p2mb-items button:hover{background:#190f0c;color:#d7beb3}
.p2mb-items button.on{border-left-color:#d25d32;background:#23130e;color:#f0d7cb}
.p2mb-items p{margin:10px 8px;color:#79675e;font-size:11.5px}
@media(max-width:620px){.p2mb-browser{grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr);height:auto;max-height:none}.p2mb-browser.sticky{position:static}.p2mb-search{grid-column:auto}.p2mb-categories{max-height:260px}.p2mb-items{max-height:320px}}
`;
