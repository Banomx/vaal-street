import { SourceStrip } from "./AppShell.jsx";

/* Says what is wrong with the data on screen, in the words the reader needs.

   Rendered from the structured verdict `summarize()` produces, so the page
   never has to decide for itself whether a missing history is worth a banner.
   Nothing here is decorative: if this component renders, something about the
   snapshot is not ordinary, and staying silent would mean showing suspect
   numbers as if they were fine. */

const HEADLINE = {
  notice: "Some data is incomplete",
  warning: "This data may be out of date",
  error: "This page cannot show current data",
};

const TONE = { notice: "notice", warning: "warning", error: "error" };

export default function SnapshotNotice({ verdict, className = "", headline }) {
  if (!verdict || verdict.level === "ok" || !verdict.notes?.length) return null;
  const level = verdict.level;
  return (
    <SourceStrip className={`app-source-strip--spaced app-snapshot-notice ${className}`.trim()} tone={TONE[level] || "quiet"}>
      <strong>{headline || HEADLINE[level]}</strong>
      <ul>
        {verdict.notes.map((note, index) => <li key={`${note.level}-${index}`}>{note.text}</li>)}
      </ul>
    </SourceStrip>
  );
}
