import { ReactNode } from "react";

/**
 * The one page-header pattern: accent icon chip + display title (h1 for
 * standalone pages, h2 for dashboard tabs) + one subtitle size + actions.
 */
export default function PageHeader({
  icon,
  iconBg = "from-gray-500 to-gray-700",
  title,
  subtitle,
  actions,
  as = "h1",
  className = "",
}: {
  icon: ReactNode;
  /** Tailwind gradient classes for the chip, e.g. "from-blue-500 to-blue-700". */
  iconBg?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  const Tag = as;
  return (
    <div className={`flex items-center gap-4 flex-wrap ${className}`}>
      <div
        className={`w-[52px] h-[52px] rounded-[14px] bg-gradient-to-br ${iconBg} text-white flex items-center justify-center flex-none shadow-[0_10px_24px_-10px_rgb(2_6_23/0.6),inset_0_1px_0_rgb(255_255_255/0.25)] ring-1 ring-white/10`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <Tag className="font-display font-bold text-3xl tracking-tight text-hi leading-tight">
          {title}
        </Tag>
        {subtitle ? (
          <p className="text-sm text-mut mt-0.5 text-balance">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2.5 flex-wrap ml-auto">{actions}</div>
      ) : null}
    </div>
  );
}
