import { TopNavSkeleton } from "@/components/RouteSkeleton";

// Skeleton yang meniru layout dashboard: tampil INSTAN saat navigasi
// (login → dashboard, antar halaman) selagi data di-fetch di server.
export default function DashboardLoading() {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8FF] animate-pulse" aria-label="Memuat dashboard…">
      <TopNavSkeleton />
      <div className="flex-1 px-4 sm:px-6 md:px-8 py-6 max-w-[540px] md:max-w-[760px] lg:max-w-[960px] mx-auto w-full space-y-4">
        <div className="pt-2 pb-1 space-y-2">
          <div className="h-4 w-32 bg-purple-100 rounded" />
          <div className="h-9 w-48 bg-purple-100 rounded-lg" />
        </div>
        <div className="bg-white rounded-3xl p-5 border border-purple-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-purple-100" />
            <div className="space-y-2">
              <div className="h-4 w-28 bg-purple-100 rounded" />
              <div className="h-3 w-20 bg-gray-200/80 rounded" />
            </div>
          </div>
          <div className="h-5 w-20 bg-purple-100 rounded" />
        </div>
        <div className="bg-white rounded-3xl p-5 border border-gray-100 space-y-3">
          <div className="h-3 w-32 bg-gray-200/80 rounded" />
          <div className="h-9 w-64 max-w-full bg-gray-200/80 rounded-full" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-3xl p-5 bg-gray-200/50 space-y-2">
              <div className="h-8 w-16 bg-gray-300/60 rounded-lg" />
              <div className="h-3 w-24 bg-gray-300/60 rounded" />
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-3">
          <div className="h-11 w-36 bg-purple-200 rounded-full" />
          <div className="h-11 w-36 bg-purple-100 rounded-full" />
        </div>
        <div className="bg-white rounded-3xl border border-gray-100 p-5 space-y-3">
          <div className="h-5 w-40 bg-gray-200/80 rounded" />
          <div className="h-40 bg-gray-100 rounded-2xl" />
        </div>
        <div className="bg-white rounded-3xl border border-gray-100 p-5 space-y-3">
          <div className="h-5 w-44 bg-gray-200/80 rounded" />
          <div className="h-24 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
