/**
 * Elliott brand mark — hand-drawn SVG, no external assets.
 *
 * A clean 5-wave Elliott impulse inside a dark terminal badge:
 *  - Wave geometry respects the classic impulse rules (wave 3 longest,
 *    wave 2 does not retrace past the start, wave 4 stays above wave 1 territory).
 *  - Dashed support trendline running through the wave troughs (trailing-stop nod).
 *  - Emerald → teal gradient stroke with a terminal dot at the wave-5 peak.
 */
export function ElliottLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient
          id="elliott-wave-g"
          x1="7"
          y1="31"
          x2="33"
          y2="6"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#059669" />
          <stop offset="0.55" stopColor="#10b981" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
        <radialGradient
          id="elliott-glow"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(27 13) rotate(118) scale(17.5 14)"
        >
          <stop offset="0" stopColor="#10b981" stopOpacity="0.26" />
          <stop offset="1" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* badge */}
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="10.5" fill="#0A100D" />
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="10.5" fill="url(#elliott-glow)" />
      <rect
        x="0.75"
        y="0.75"
        width="38.5"
        height="38.5"
        rx="10.5"
        stroke="#203028"
        strokeWidth="1.5"
      />
      {/* glass top highlight */}
      <path
        d="M10 3.4 H30"
        stroke="#FFFFFF"
        strokeOpacity="0.07"
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* support trendline through troughs */}
      <path
        d="M6.4 31 L34.2 11"
        stroke="#34D399"
        strokeOpacity="0.16"
        strokeWidth="1.1"
        strokeDasharray="2.6 3.2"
        strokeLinecap="round"
      />

      {/* 5-wave impulse: 0 → 1 → 2 → 3 → 4 → 5 */}
      <path
        d="M7 30 L12.5 19.5 L16.5 24.5 L23.5 11.5 L27.5 16 L33 7"
        stroke="url(#elliott-wave-g)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* wave-5 terminal dot */}
      <circle cx="33" cy="7" r="4.4" fill="#2DD4BF" opacity="0.16" />
      <circle cx="33" cy="7" r="2.1" fill="#2DD4BF" />
    </svg>
  );
}
