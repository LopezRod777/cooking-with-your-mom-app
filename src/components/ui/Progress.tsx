export function Progress({ current, total }: { current: number; total: number }) {
  return (
    <div className="grid gap-3" aria-label={`Step ${current} of ${total}`}>
      <p className="text-[16px] font-semibold tracking-wide text-muted">
        Step {current} of {total}
      </p>
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={[
              "h-2 flex-1 rounded-full transition-colors",
              i < current ? "bg-tomato" : "bg-line",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}

/** Thin segmented line. `onDark` = cream segments for use over a photo. */
export function ProgressSegments({
  current,
  total,
  onDark = false,
}: {
  current: number;
  total: number;
  onDark?: boolean;
}) {
  return (
    <div className="flex gap-1.5" role="img" aria-label={`Step ${current} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={[
            "h-[3px] flex-1 rounded-full transition-colors duration-200",
            i < current
              ? onDark
                ? "bg-[#fff6ea]"
                : "bg-ink"
              : onDark
                ? "bg-[#fff6ea]/35"
                : "bg-line",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
