import TopNav from "@/components/TopNav";

export default function NavTestPage() {
  return (
    <div className="min-h-screen">
      <TopNav patientName="Budi" patientAge={45} />
      <div className="p-8">
        <p className="text-sm text-soft">Halaman uji sementara untuk hamburger menu.</p>
      </div>
    </div>
  );
}
