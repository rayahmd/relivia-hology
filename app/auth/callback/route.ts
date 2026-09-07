import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Allow only same-origin relative paths (prevent open redirects). */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/dashboard";
}

/** Redirect ke /login dengan membawa pesan error yang bisa dibaca UI. */
function loginErrorRedirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Supabase/Google menolak di sisi mereka (mis. Redirect URL belum masuk
  // allow-list di dashboard, atau user membatalkan di layar consent).
  // Teruskan deskripsi aslinya supaya /login bisa menampilkannya,
  // bukan pesan generik yang bikin retry buta.
  const oauthError = searchParams.get("error");
  if (oauthError) {
    const desc =
      searchParams.get("error_description") ?? searchParams.get("error_code") ?? oauthError;
    // eslint-disable-next-line no-console
    console.error("[ReliviaAuth] callback oauth error:", oauthError, desc);
    return loginErrorRedirect(request, { error: "oauth", error_description: desc });
  }

  if (!code) {
    // eslint-disable-next-line no-console
    console.error("[ReliviaAuth] callback tanpa code");
    return loginErrorRedirect(request, { error: "auth_failed" });
  }

  // PENTING: cookie jar harus ditempel ke response redirect yang sama.
  // Pola lama (createClient() dari @/lib/supabase/server yang menulis ke
  // cookies() global lalu me-return NextResponse.redirect() baru) bisa
  // membuang Set-Cookie hasil exchange — sesi terbentuk di server tapi
  // tidak pernah sampai ke browser, user mental balik ke /login.
  const response = NextResponse.redirect(new URL(next, request.url));
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
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[ReliviaAuth] exchangeCodeForSession gagal:", error.message);
    return loginErrorRedirect(request, {
      error: "auth_failed",
      error_description: error.message,
    });
  }
  return response;
}
