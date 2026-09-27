/**
 * Generic page skeleton for loading.tsx boundaries: title, a KPI strip and
 * content rows on the surface shimmer (turned off under reduced motion).
 */

interface PageSkeletonProps {
  /** Number of KPI cells to render in the top strip. */
  cards?: number;
  /** Number of content row skeletons below the strip. */
  rows?: number;
}

export default function PageSkeleton({ cards = 3, rows = 5 }: PageSkeletonProps) {
  return (
    <div className="px-4 pt-5 sm:px-6 lg:px-10 lg:pt-8 flex flex-col gap-7" aria-busy="true" aria-label="Loading">
      <div>
        <div className="h-8 w-56 rounded skeleton" />
        <div className="mt-2 h-4 w-80 rounded skeleton" />
      </div>
      {cards > 0 && (
        <div className="card grid gap-px overflow-hidden" style={{ gridTemplateColumns: `repeat(${Math.min(cards, 4)}, minmax(0, 1fr))` }}>
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="p-5">
              <div className="h-3.5 w-24 rounded skeleton" />
              <div className="mt-3 h-7 w-28 rounded skeleton" />
            </div>
          ))}
        </div>
      )}
      <div className="card p-5 flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-10 rounded skeleton" style={{ width: `${85 + (i % 3) * 5}%` }} />
        ))}
      </div>
    </div>
  );
}
