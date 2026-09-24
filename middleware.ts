import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Auth check tanpa network roundtrip: getClaims() memverifikasi JWT
  // secara lokal dari cookie (0 RTT saat token valid; refresh otomatis
  // hanya bila expired). Sebelumnya getUser() memanggil Auth server di
  // SETIAP navigasi protected (+ onboarding query sesudahnya) sehingga
  // tiap pindah halaman membayar 2 roundtrip serial (~0.5–1s+ di mobile).
  // Keamanan tidak berkurang: RLS Postgres tetap memverifikasi JWT per
  // query, dan bila project memakai HS256 getClaims otomatis fallback ke
  // getUser (perilaku lama). Server Components/API tetap memakai getUser.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;

  const authRequiredPaths = ["/dashboard", "/checkin", "/insight", "/summary", "/community", "/onboarding", "/agent", "/health"];
  const isAuthRequired = authRequiredPaths.some((p) => request.nextUrl.pathname.startsWith(p));

  if (isAuthRequired && !userId) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  // Gate protected pages (but not /onboarding itself, to avoid a redirect loop)
  // behind onboarding completeness: a caregiver must have set patient
  // name/age before they can use the app. One lightweight query per navigation
  // is an acceptable tradeoff for correctness over a stale cached flag.
  const onboardingRequiredPaths = ["/dashboard", "/checkin", "/insight", "/summary", "/community", "/agent", "/health"];
  const needsOnboardingCheck = onboardingRequiredPaths.some((p) => request.nextUrl.pathname.startsWith(p));

  if (needsOnboardingCheck && userId) {
    const { data: patient } = await supabase
      .from("patients")
      .select("age")
      .eq("caregiver_id", userId)
      .maybeSingle();

    if (!patient || patient.age === null) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/onboarding";
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/checkin/:path*", "/insight/:path*", "/summary/:path*", "/community/:path*", "/onboarding/:path*", "/agent/:path*", "/health/:path*"],
};
