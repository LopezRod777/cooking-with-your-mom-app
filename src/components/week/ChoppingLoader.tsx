// Loading: a real walnut board, a bunch of green onions and a chef's knife (photo layers generated once, keyed out;
// scripts/data/loader-key.mjs). The knife slides from the green tips toward the bulbs, rocking once per cut; the
// bunch shortens under the blade (clip-path follows the knife) and real rings tumble off the cut. Then a fresh bunch.
// About 3.2 s per loop; a still arrangement under reduced motion.
const PIECES = 12;
const CUT_PART = 0.78; // share of the loop spent cutting
const ONION_LEFT = 6; // % of the board width where the green tips start
const ONION_W = 78; // % width of the bunch
const LIFT = (22 / 56.25) * 100; // 22 % of the board width, as a share of its 16:9 height
const CUT_END = ONION_LEFT + ONION_W * 0.86; // the knife stops just before the bulbs
const KNIFE_W = 48; // % of the board width (the blade stands across the bunch, so this is its length)
const KNIFE_ANCHOR = "40% 100%"; // the point of the edge that does the cutting (40 % along from the tip)
const KNIFE_TILT = 82; // degrees: blade across the bunch, tip toward the top, handle toward the bottom (the cook stands in front)
// Crops from rings.png (500×519): x, y, w, h of single rings, green and white.
const RING_CROPS = [
  [0, 0, 180, 160],
  [320, 0, 180, 160],
  [245, 160, 120, 120],
  [370, 290, 130, 140],
] as const;

export function ChoppingLoader({ label = "Planning your week" }: { label?: string } = {}) {
  const cutSpan = CUT_END - ONION_LEFT;
  return (
    <div role="progressbar" aria-label={label}className="cwym-chop relative w-full max-w-[360px] overflow-hidden rounded-[18px] shadow-[0_18px_40px_-20px_rgba(28,20,14,0.6)]" style={{ aspectRatio: "16 / 9", containerType: "inline-size" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/media/loader/board.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 rounded-[18px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_10px_30px_rgba(0,0,0,0.18)]" />
      {/* the bunch: clipped from the left as the knife advances */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/media/loader/onions.png" alt="" className="cwym-onion absolute" style={{ left: `${ONION_LEFT}%`, width: `${ONION_W}%`, top: "50%", transform: "translateY(-46%)", filter: "drop-shadow(0 6px 6px rgba(0,0,0,0.35))" }} />
      {/* rings: one per cut, born on the cut line, three tumbling arcs, four real crops */}
      {Array.from({ length: PIECES }, (_, i) => {
        const [cx, cy, cw, ch] = RING_CROPS[i % RING_CROPS.length];
        const k = 0.19; // crop scale
        const left = ONION_LEFT + (cutSpan * (i + 0.5)) / PIECES;
        return (
          <span
            key={i}
            className={`cwym-ring cwym-ring-${i % 3} absolute`}
            style={{
              ["--i" as string]: i,
              left: `${left}%`,
              top: "50%",
              width: cw * k,
              height: ch * k,
              marginLeft: -(cw * k) / 2,
              marginTop: -(ch * k) / 2,
              backgroundImage: "url(/media/loader/rings.png)",
              backgroundSize: `${500 * k}px ${519 * k}px`,
              backgroundPosition: `${-cx * k}px ${-cy * k}px`,
              filter: "drop-shadow(0 3px 3px rgba(0,0,0,0.35))",
            }}
          />
        );
      })}
      {/* the knife: the outer span slides along the cut line; the pose stands the blade across the bunch with the
          cutting point of the edge on the anchor; the image rocks around that same point */}
      <span className="cwym-knife absolute" style={{ width: `${KNIFE_W}%`, left: 0, top: "50%" }}>
        <span className="cwym-pose block" style={{ transformOrigin: KNIFE_ANCHOR, transform: `translate(-40%, -100%) rotate(${KNIFE_TILT}deg)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/media/loader/knife.png" alt="" className="cwym-blade block w-full" style={{ transformOrigin: KNIFE_ANCHOR, filter: "drop-shadow(8px 10px 10px rgba(0,0,0,0.45))" }} />
        </span>
      </span>
      <style>{`
        .cwym-chop { --loop: 3.2s; --cutpart: ${CUT_PART}; --cut: calc(var(--loop) * var(--cutpart) / ${PIECES}); }
        /* knife: the cut line (22 % along the blade from the tip) travels from the green tips to the bulbs */
        .cwym-knife { animation: cwym-sweep var(--loop) linear infinite; }
        /* left/top in % of the board (no cqw inside keyframes: Safari resolves it to 0 and the knife stays at the left edge) */
        @keyframes cwym-sweep {
          0%   { left: ${ONION_LEFT + 2}%; top: 50%; opacity: 1; }
          ${Math.round(CUT_PART * 100)}%  { left: ${CUT_END}%; top: 50%; opacity: 1; }
          ${Math.round(CUT_PART * 100) + 8}% { left: ${CUT_END + 4}%; top: ${50 - LIFT}%; opacity: 1; }
          ${Math.round(CUT_PART * 100) + 9}% { opacity: 0; }
          ${Math.round(CUT_PART * 100) + 12}% { opacity: 0; left: ${ONION_LEFT - 2}%; top: ${50 - LIFT}%; }
          95%  { opacity: 1; left: ${ONION_LEFT + 2}%; top: ${50 - LIFT * 0.36}%; }
          100% { opacity: 1; left: ${ONION_LEFT + 2}%; top: 50%; }
        }
        /* rocking chop: heel drops fast, lifts slower; the tip stays low */
        .cwym-blade { animation: cwym-rock var(--cut) cubic-bezier(.55,0,.7,.5) infinite; }
        @keyframes cwym-rock { 0% { transform: rotate(-10deg) translateY(-6%); } 42% { transform: rotate(0deg) translateY(0); } 54% { transform: rotate(0deg) translateY(0); } 100% { transform: rotate(-10deg) translateY(-6%); } }
        /* the bunch shortens from the left; fades, resets while the knife is away, fades back */
        .cwym-onion { animation: cwym-clip var(--loop) linear infinite; }
        @keyframes cwym-clip {
          0% { clip-path: inset(0 0 0 0); opacity: 1; }
          ${Math.round(CUT_PART * 100)}% { clip-path: inset(0 0 0 ${(cutSpan / ONION_W) * 100}%); opacity: 1; }
          ${Math.round(CUT_PART * 100) + 6}% { clip-path: inset(0 0 0 ${(cutSpan / ONION_W) * 100}%); opacity: 0; }
          ${Math.round(CUT_PART * 100) + 7}% { clip-path: inset(0 0 0 0); opacity: 0; }
          96% { clip-path: inset(0 0 0 0); opacity: 1; }
          100% { clip-path: inset(0 0 0 0); opacity: 1; }
        }
        .cwym-ring { opacity: 0; animation-duration: var(--loop); animation-timing-function: linear; animation-iteration-count: infinite; animation-delay: calc(var(--i) * var(--cut)); }
        .cwym-ring-0 { animation-name: cwym-tumble-a; }
        .cwym-ring-1 { animation-name: cwym-tumble-b; }
        .cwym-ring-2 { animation-name: cwym-tumble-c; }
        @keyframes cwym-tumble-a {
          0%, 1.5% { opacity: 0; transform: translate(0,0) rotate(0) scale(.6); }
          2% { opacity: 1; transform: translate(3px,-8px) rotate(15deg) scale(1); }
          6% { transform: translate(18px,-38px) rotate(140deg); }
          10% { transform: translate(34px,-16px) rotate(260deg); }
          13% { transform: translate(44px,10px) rotate(330deg) scale(1,.55); }
          16% { opacity: 1; transform: translate(47px,12px) rotate(340deg) scale(1,.5); }
          19%, 100% { opacity: 0; transform: translate(47px,12px) rotate(340deg) scale(1,.5); }
        }
        @keyframes cwym-tumble-b {
          0%, 1.5% { opacity: 0; transform: translate(0,0) rotate(0) scale(.6); }
          2% { opacity: 1; transform: translate(-2px,-10px) rotate(-20deg) scale(1); }
          6.5% { transform: translate(-6px,-50px) rotate(-210deg); }
          11% { transform: translate(-10px,-24px) rotate(-350deg); }
          14% { transform: translate(-12px,12px) rotate(-450deg) scale(1,.55); }
          17% { opacity: 1; transform: translate(-13px,14px) rotate(-455deg) scale(1,.5); }
          20%, 100% { opacity: 0; transform: translate(-13px,14px) rotate(-455deg) scale(1,.5); }
        }
        @keyframes cwym-tumble-c {
          0%, 1.5% { opacity: 0; transform: translate(0,0) rotate(0) scale(.6); }
          2% { opacity: 1; transform: translate(-4px,-6px) rotate(10deg) scale(1); }
          5.5% { transform: translate(-20px,-24px) rotate(100deg); }
          9% { transform: translate(-34px,-8px) rotate(170deg); }
          11.5% { transform: translate(-42px,12px) rotate(200deg) scale(1,.55); }
          14% { opacity: 1; transform: translate(-44px,14px) rotate(205deg) scale(1,.5); }
          17%, 100% { opacity: 0; transform: translate(-44px,14px) rotate(205deg) scale(1,.5); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cwym-knife, .cwym-blade, .cwym-onion, .cwym-ring { animation: none; }
          .cwym-ring { opacity: 0; }
          .cwym-knife { left: ${ONION_LEFT + 30}% !important; top: ${50 - (4 / 56.25) * 100}% !important; }
        }
      `}</style>
    </div>
  );
}
