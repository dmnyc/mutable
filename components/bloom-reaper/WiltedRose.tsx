"use client";

// Bloom Reaper's mark: the wilted flower line art (OpenMoji's wilted flower,
// CC BY-SA 4.0), drawn with the currentColor stroke so it renders white on
// dark chips. Height drives width; the art is a touch taller than wide.
export default function WiltedRose({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      width={size * (49.92 / 51.48)}
      height={size}
      viewBox="0 0 49.92 51.48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M46.53,28.37c2.2-.99,3.09-4.58,1.79-6.73-1.25-2.06-4.81-4.23-7.01-3.24" />
      <path d="M29.77,22.79c1.7-1.7,3.94-2.56,6.17-2.56s4.47.85,6.17,2.56" />
      <path d="M34.26,34.07c-4.27,3.39-9.09.15-9.94-1.92-1.35-3.28-.38-7.82,2.05-9.24" />
      <path d="M40.54,24.98c1.15,1.15.92,3.26-.52,4.7s-3.55,1.68-4.7.52" />
      <path d="M32.36,30.1c-.82-.82-.65-2.32.37-3.34.53-.53,1.27-.79,2-.82,1.13-.05,2.21.65,2.6,1.7.06.15.09.31.1.45" />
      <path d="M34.86,46.43c-.18.98-1.49,1.56-2.92,1.3-1.43-.27-2.43-1.28-2.25-2.26l1.38-2.62c.89-1.52.93-1.53,1.87-1.33l.3.06c.95.16.98.18,1.27,1.92l.35,2.94" />
      <path d="M21.24,25.75c-2.32-.66-3.66-3.08-2.99-5.4.66-2.32,3.08-3.66,5.4-2.99" />
      <path d="M46.53,28.37c1.57,3.39.1,7.41-3.28,8.98-3.39,1.57-7.41.1-8.98-3.28" />
      <path d="M41.3,18.39c-1.25-4.12-5.6-6.45-9.72-5.2s-6.45,5.6-5.2,9.72" />
      <path d="M1.66,29c1.54-3.18,5.67-4.36,5.67-4.36,0,0,1.63,3.98.09,7.16s-5.67,4.36-5.67,4.36c0,0-1.63-3.98-.09-7.16Z" />
      <path d="M31.73,8.72C29.09,2.34,21.77-.69,15.4,1.95s-9.41,9.95-6.77,16.33c0,0,10.66,22.19,9.66,32.19" />
    </svg>
  );
}
