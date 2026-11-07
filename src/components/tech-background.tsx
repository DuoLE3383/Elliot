// ─── TechBackground — nền circuit-tech toàn cục (0.2.83) ─────────────────────
// Tái lập hình nền user gửi: nền navy đen sâu, các đường mạch PCB kiểu
// Manhattan chạy ngang từ hai mép vào giữa (đối xứng gương) kết thúc bằng node
// tròn phát sáng, dải ô pixel xanh dày ở tâm và sao trắng lấp lánh rải rác.
// Toàn bộ animation là CSS thuần (keyframes trong globals.css): dòng điện chạy
// dọc mạch (stroke-dashoffset), node nhấp nháy, pixel sáng mờ dần dần, sao
// twinkle — không JS loop, không đụng scroll/perf.
// QUAN TRỌNG: mọi vị trí/độ mờ đều sinh bằng CÔNG THỨC cố định (không
// Math.random) → SSR và client render giống hệt nhau, không hydration mismatch.
// Mount MỘT LẦN trong src/app/layout.tsx, trước {children}; z-[-1] để nằm dưới
// toàn bộ nội dung nhưng trên nền canvas của body.

const W = 1440;
const H = 900;

// trace bên trái: từ mép chạy vào trong, kiểu góc vuông PCB, cuối là node
const TRACES: { d: string; node: [number, number] }[] = [
  { d: "M0,150 H180 L220,190 H340", node: [340, 190] },
  { d: "M0,262 H120 L160,300 H262 L300,262 H384", node: [384, 262] },
  { d: "M0,418 H196 L246,468 H332", node: [332, 468] },
  { d: "M0,596 H92 L132,636 H282 L322,596 H424", node: [424, 596] },
  { d: "M0,752 H148 L188,712 H312", node: [312, 712] },
  { d: "M64,0 V88 L104,128 H244", node: [244, 128] },
  { d: "M300,900 V824 L340,784 H472", node: [472, 784] },
  { d: "M0,64 H96 L136,104 H212", node: [212, 104] },
];

// 3 "bus" ngang chạy hết chiều rộng phía sau pixel mosaic — dòng dữ liệu chính
const BUSES = ["M0,334 H1440", "M0,562 H1440", "M0,676 H1440"];

// pixel mosaic ở tâm — 30×12 ô, opacity + nhấp nháy theo công thức phần tử-fixed
const MC = 30;
const MR = 12;
const CELL = 11;
const GAP = 5;
const MOSAIC: { x: number; y: number; o: number; blink: boolean; d: number }[] = [];
for (let r = 0; r < MR; r++) {
  for (let c = 0; c < MC; c++) {
    const i = r * MC + c;
    MOSAIC.push({
      x: 483 + c * (CELL + GAP),
      y: 296 + r * (CELL + GAP),
      o: 0.05 + (((i * 29) % 23) / 23) * 0.3,
      blink: i % 13 === 3,
      d: (i % 17) * 0.35,
    });
  }
}

// 22 ngôi sao 4 cánh — vị trí công thức cố định, vài ngôi cyan vài ngôi trắng
const STARS = Array.from({ length: 22 }, (_, i) => {
  const s = 2.6 + ((i * 7) % 5);
  return {
    x: ((i * 173) % 1380) + 30,
    y: ((i * 97) % 820) + 40,
    s,
    d: (i % 9) * 0.45,
    dur: 3.2 + (i % 5) * 0.7,
    cyan: i % 6 === 2,
  };
});

const starPath = "M0,-6 L1.7,-1.7 L6,0 L1.7,1.7 L0,6 L-1.7,1.7 L-6,0 L-1.7,-1.7 Z";

export function TechBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden bg-[#020617]">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        <defs>
          <radialGradient id="tb-glow" cx="50%" cy="38%" r="78%">
            <stop offset="0%" stopColor="#0a1f3d" />
            <stop offset="55%" stopColor="#030b1c" />
            <stop offset="100%" stopColor="#01040c" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#tb-glow)" />

        {/* bus ngang full-width + dòng điện chạy dọc */}
        {BUSES.map((d, i) => (
          <path key={`b${i}`} d={d} fill="none" stroke="#155e75" strokeWidth="1" opacity="0.32" />
        ))}
        {BUSES.map((d, i) => (
          <path
            key={`bp${i}`}
            className="circuit-pulse"
            d={d}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="1.6"
            style={{ animationDuration: `${9 + i * 3}s`, animationDelay: `${i * 2.5}s` }}
          />
        ))}

        {/* mạch hai mép: bản trái + gương phải, mỗi trace có node + xung điện */}
        {[false, true].map((mir) => (
          <g key={mir ? "r" : "l"} transform={mir ? `translate(${W},0) scale(-1,1)` : undefined}>
            {TRACES.map((t, i) => (
              <path key={`t${i}`} d={t.d} fill="none" stroke="#0e7490" strokeWidth="1.4" opacity="0.5" />
            ))}
            {TRACES.map((t, i) => (
              <path
                key={`tp${i}`}
                className="circuit-pulse"
                d={t.d}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1.8"
                style={{ animationDuration: `${6 + (i % 4) * 2}s`, animationDelay: `${i * 1.3}s` }}
              />
            ))}
            {TRACES.map((t, i) => (
              <circle
                key={`tn${i}`}
                className="node-dot"
                cx={t.node[0]}
                cy={t.node[1]}
                r="3.4"
                fill="#22d3ee"
                style={{ animationDelay: `${(i % 5) * 0.8}s` }}
              />
            ))}
          </g>
        ))}

        {/* pixel mosaic ở tâm — dày dặc, một phần ô nhấp nháy chậm */}
        <g>
          {MOSAIC.map((m, i) => (
            <rect
              key={i}
              x={m.x}
              y={m.y}
              width={CELL}
              height={CELL}
              rx="1.5"
              fill="#0ea5e9"
              opacity={m.o}
              className={m.blink ? "mosaic-cell" : undefined}
              style={m.blink ? { animationDelay: `${m.d}s` } : undefined}
            />
          ))}
        </g>

        {/* sao trắng/cyan lấp lánh */}
        {STARS.map((st, i) => (
          <path
            key={i}
            className="sparkle"
            transform={`translate(${st.x},${st.y}) scale(${(st.s / 6).toFixed(2)})`}
            fill={st.cyan ? "#67e8f9" : "#eaf6ff"}
            opacity="0.7"
            style={{ animationDelay: `${st.d}s`, animationDuration: `${st.dur}s` }}
            d={starPath}
          />
        ))}
      </svg>

      {/* phủ tối dần về đáy — nội dung chữ vẫn dễ đọc trên nền động */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#020617]/30 to-[#020617]/75" />
    </div>
  );
}
