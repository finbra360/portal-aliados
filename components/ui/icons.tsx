type IconProps = { className?: string };

const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function IconTrendingUp({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}

export function IconWallet({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M18 12h3v4h-3a2 2 0 0 1 0-4Z" />
    </svg>
  );
}

export function IconListChecks({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m3 7 2 2 4-4" />
      <path d="m3 15 2 2 4-4" />
      <line x1="12" y1="6" x2="21" y2="6" />
      <line x1="12" y1="16" x2="21" y2="16" />
    </svg>
  );
}

export function IconTrophy({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M17 5h3a3 3 0 0 1-3 5M7 5H4a3 3 0 0 0 3 5" />
    </svg>
  );
}

export function IconTarget({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}

export function IconFlame({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 2s-3 3.5-3 7a3 3 0 0 0 6 0c0-1-1-2-1-2s2 1 2 4a4 4 0 0 1-8 0c0-4 4-9 4-9Z" />
    </svg>
  );
}

export function IconCoins({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="9" r="5" />
      <path d="M14 9a5 5 0 1 0 0 6.9M9 9v.01M9 13v.01" />
    </svg>
  );
}
