// Purgatory's pitchfork, drawn on lucide's 24px grid (2px round stroke) so it
// sits beside the lucide icons; lucide has no pitchfork of its own.
export default function Pitchfork({
  size = 24,
  strokeWidth = 2,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 3v5a7 7 0 0 0 14 0V3" />
      <path d="M12 3v19" />
    </svg>
  );
}
