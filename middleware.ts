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

  // auth check without a network roundtrip: getClaims() verifies the jwt
  // locally from the cookie. rls still verifies per query, so security
  // is unchanged. server components / api routes keep using getUser.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;

  const pathname = request.nextUrl.pathname;

  // no landing page: "/" always resolves into the app. logged-in users
  // go to /dashboard, guests to /login. the ?code= exception preserves the
  // oauth safety net (provider sometimes returns the code to the site root).
  if (pathname === "/") {
    if (!userId && request.nextUrl.searchParams.has("code")) return response;
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = userId ? "/dashboard" : "/login";
    return NextResponse.redirect(redirectUrl);
  }

  // logged-in users never see /login: redirect server-side before its
  // html is sent. the onboarding gate below forwards to /onboarding after.
  if (userId && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  const authRequiredPaths = ["/dashboard", "/checkin", "/insight", "/summary", "/community", "/onboarding", "/agent", "/health"];
  const isAuthRequired = authRequiredPaths.some((p) => pathname.startsWith(p));

  if (isAuthRequired && !userId) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  // gate protected pages (not /onboarding itself, to avoid a loop)
  // behind onboarding completeness. one lightweight query per navigation
  // beats a stale cached flag.
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
  matcher: ["/", "/login", "/dashboard/:path*", "/checkin/:path*", "/insight/:path*", "/summary/:path*", "/community/:path*", "/onboarding/:path*", "/agent/:path*", "/health/:path*"],
};
