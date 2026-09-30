import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Allow only same-origin relative paths (prevent open redirects). */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/dashboard";
}

/** redirect ke /login dengan pesan error yang bisa dibaca ui. */
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

  // provider menolak di sisinya (redirect url belum allow-list, atau
  // user batal di layar consent). teruskan deskripsi aslinya supaya
  // /login menampilkannya, bukan pesan generik yang bikin retry buta.
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

  // cookie jar must attach to the same redirect response. the old pattern
  // (fresh redirect after exchange) dropped set-cookie: session formed
  // server-side but never reached the browser, bouncing the user to /login.
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
