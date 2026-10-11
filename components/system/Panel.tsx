import { ReactNode } from "react";

/**
 * The one card surface: token gradient (.panel), hairline border, deep
 * shadow, rounded-xl. Compose headers with PanelHeader.
 */
export default function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`panel relative rounded-xl border border-line shadow-panel ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  note,
  actions,
}: {
  title: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
      <div className="flex items-center gap-3 min-w-0">
        <h3 className="font-display font-semibold text-base text-hi truncate">
          {title}
        </h3>
        {note ? <span className="text-sm text-mut truncate">{note}</span> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-none">{actions}</div> : null}
    </div>
  );
}
