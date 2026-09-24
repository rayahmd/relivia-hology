import { createClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/getOrCreateProfile";
import { getOrCreatePatient } from "@/lib/getOrCreatePatient";
import TopNav from "@/components/TopNav";
import CommunityFeed from "@/components/CommunityFeed";
import ShareStoryForm from "@/components/ShareStoryForm";
import type { CommunityPost } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CommunityPage() {
  const supabase = createClient();
  // profile dan patient independen → paralel, bukan 2x serial.
  const [profile, patient] = await Promise.all([getOrCreateProfile(), getOrCreatePatient()]);

  const { data: postsRaw } = await supabase
    .from("community_posts")
    .select("id, author_id, body, helpful_count, created_at, profiles(display_name, is_verified, city)")
    .order("created_at", { ascending: false })
    .limit(50);

  const posts = (postsRaw ?? []) as unknown as CommunityPost[];

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav patientName={patient.name} patientAge={patient.age} />
      <div className="flex-1 px-4 md:px-[5vw] py-8 max-w-[820px] mx-auto w-full">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <h2 className="text-2xl font-extrabold mb-1">Komunitas Caregiver</h2>
            <p className="text-sm text-soft">Cerita dari caregiver lain — murni berbagi pengalaman, bukan saran medis.</p>
          </div>
          <ShareStoryForm />
        </div>

        <div className="bg-primary-light text-primary-dark text-sm font-semibold px-[18px] py-3.5 rounded-2xl mb-5 leading-relaxed">
          Ruang ini untuk saling menguatkan antar caregiver. Isi di sini bukan nasihat medis dan tidak
          menggantikan konsultasi dengan psikiater.{" "}
          {profile.is_verified
            ? "Akunmu sudah bertanda Terverifikasi karena konsisten mencatat 14+ hari."
            : `Catat ${Math.max(0, 14 - profile.total_checkins)} hari lagi untuk dapat badge Terverifikasi.`}
        </div>

        <CommunityFeed posts={posts} currentUserId={profile.id} />
      </div>
    </div>
  );
}
