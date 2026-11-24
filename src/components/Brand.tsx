export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="fvg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" /><stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0a1325" stroke="url(#fvg)" strokeWidth="1.5" />
      <path d="M9 24V9h13M9 16h9" stroke="url(#fvg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M17 24l4-5 3 3 4-7" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={size} />
      <span className="text-[15px] font-bold tracking-[0.18em]">FINVANTA</span>
    </span>
  );
}
