interface IconProps {
  size?: number;
  className?: string;
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function MicIcon({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" {...base} />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" {...base} />
    </svg>
  );
}

export function SendIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 12h14M13 6l6 6-6 6" {...base} />
    </svg>
  );
}

export function SpeakerIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 10v4h3l4 3V7L7 10H4Z" {...base} />
      <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" {...base} />
    </svg>
  );
}

export function SpeakerOffIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 10v4h3l4 3V7L7 10H4Z" {...base} />
      <path d="M16 10l4 4M20 10l-4 4" {...base} />
    </svg>
  );
}

export function ArrowIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" {...base} />
    </svg>
  );
}

export function ResetIcon({ size = 17, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 10a8 8 0 1 1 1.6 6.7M4 4v6h6" {...base} />
    </svg>
  );
}

export function ShopMark({ size = 42, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="13" fill="#14532d" />
      <path d="M10 18.5 13 10h22l3 8.5" stroke="#f6efe1" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path
        d="M10 18.5c0 2.2 1.8 4 4 4s4-1.8 4-4c0 2.2 1.8 4 4 4s4-1.8 4-4c0 2.2 1.8 4 4 4s4-1.8 4-4"
        stroke="#e9a13b"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M12.5 25v13h23V25" stroke="#f6efe1" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path d="M20 38v-8h8v8" stroke="#e9a13b" strokeWidth="2" fill="none" strokeLinejoin="round" />
    </svg>
  );
}
