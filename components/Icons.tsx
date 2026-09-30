type IconProps = { size?: number; className?: string };

const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.9 } as const;

export function IconHome({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <path d="M4 11.5L12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10.5V20h5v-5.5h2V20h5v-9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconEdit({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <path d="M14.5 4.5l4 4L8 19l-4.5 1 1-4.5L14.5 4.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSparkle({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFileText({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <path d="M7 3h7l5 5v13H7V3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 12h5M9.5 15.5h5" strokeLinecap="round" />
    </svg>
  );
}

export function IconPill({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <g transform="rotate(45 12 12)">
        <rect x="5" y="9" width="14" height="6" rx="3" />
        <line x1="12" y1="9" x2="12" y2="15" />
      </g>
    </svg>
  );
}

export function IconFlame({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <path
        d="M12 3.5c1.2 2.8-2.3 3.8-2.3 7a2.3 2.3 0 004.6 0c0-1.3-.6-1.6-.6-3 1.8.9 3.3 2.8 3.3 5a4.5 4.5 0 01-9 0c0-4 2.7-6.3 4-9z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconAlertTriangle({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <path d="M12 4.5l8.5 15h-17L12 4.5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10v4" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconMoon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <path d="M19.5 13.8A7.5 7.5 0 1110.2 4.5a6 6 0 009.3 9.3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUsers({ size = 16, className }: IconProps) {  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <circle cx="9" cy="8.5" r="2.8" />
      <path d="M4 19c0-3 2.2-5.3 5-5.3s5 2.3 5 5.3" strokeLinecap="round" />
      <circle cx="17" cy="9.5" r="2.1" />
      <path d="M15.3 13.6c1.9.3 3.4 2.2 3.7 4.9" strokeLinecap="round" />
    </svg>
  );
}

export function IconUser({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} className={className}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className={className}>
      <path d="M4.5 12l5 5 10-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
