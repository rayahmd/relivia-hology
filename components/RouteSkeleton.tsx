/**
 * Skeleton instan yang tampil selama Server Component di-fetch
 * (Next.js `loading.tsx`). Tanpa ini, tiap pindah halaman user menatap
 * halaman lama yang beku ±1s — terasa seperti delay/navigasi macet.
 */

function Block({ className = "" }: { className?: string }) {
  return <div className={`bg-gray-200/80 rounded-xl ${className}`} />;
}

export function TopNavSkeleton() {
  return (
    <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 md:px-7 pt-2.5 pb-2">
      <div className="max-w-[1180px] mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-full bg-purple-100" />
          <div className="hidden sm:block space-y-1.5">
            <div className="h-3 w-20 bg-purple-100 rounded" />
            <div className="h-2 w-14 bg-gray-100 rounded" />
          </div>
        </div>
        <div className="hidden lg:flex gap-1 bg-gray-50 rounded-full p-1 border border-gray-100">
          {[64, 88, 72, 56, 64, 80, 76].map((w) => (
            <div key={w} className="h-7 bg-gray-200/70 rounded-full" style={{ width: w }} />
          ))}
        </div>
        <div className="w-10 h-10 rounded-xl bg-gray-100 lg:hidden" />
      </div>
    </div>
  );
}

export default function RouteSkeleton({
  title = true,
  cards = 3,
}: {
  title?: boolean;
  cards?: number;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8FF] animate-pulse" aria-label="Memuat…">
      <TopNavSkeleton />
      <div className="flex-1 px-4 md:px-[5vw] py-8 max-w-[1180px] mx-auto w-full">
        {title && (
          <div className="mb-6 space-y-2">
            <div className="h-7 w-56 bg-purple-100 rounded-lg" />
            <div className="h-4 w-80 max-w-full bg-gray-200/80 rounded" />
          </div>
        )}
        <div className="space-y-4">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="bg-white rounded-3xl border border-gray-100 p-5 space-y-3">
              <Block className="h-4 w-2/5" />
              <Block className="h-4 w-full" />
              <Block className="h-4 w-3/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
