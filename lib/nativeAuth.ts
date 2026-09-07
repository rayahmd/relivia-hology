/**
 * Native Google OAuth for the Android APK (Capacitor).
 *
 * PROBLEM this fixes: `signInWithOAuth` without `skipBrowserRedirect` lets
 * the WebView navigate to supabase.co → accounts.google.com, which Android
 * hands to the external browser (Chrome). The `/auth/callback?code=...`
 * then lands in Chrome too, so the APK WebView never receives a session —
 * new accounts (which always hit Google's account-chooser + consent
 * screens) fail every time with `?error=auth_failed`.
 *
 * FIX: inside the APK we
 *  1. ask Supabase for the OAuth URL WITHOUT redirecting the WebView
 *     (`skipBrowserRedirect: true`, PKCE verifier stays in WebView storage),
 *  2. open that URL in a Custom Tab via @capacitor/browser,
 *  3. Supabase redirects to `relivia://auth/callback?code=...` (deep link,
 *     see AndroidManifest intent-filter), Android routes it back to
 *     MainActivity (singleTask) and the Capacitor App plugin emits
 *     `appUrlOpen`,
 *  4. we exchange the code for a session IN THE WEBVIEW (same storage as
 *     the verifier) and close the Custom Tab.
 *
 * REQUIRED Supabase Dashboard setup (cannot be done in code):
 *  Authentication → URL Configuration → Redirect URLs → add
 *  `relivia://auth/callback`
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Custom-scheme callback. Must match the intent-filter in AndroidManifest.xml
 *  AND the allow-list in Supabase Dashboard → URL Configuration. */
export const NATIVE_AUTH_CALLBACK = "relivia://auth/callback";

const AUTH_URL_PREFIX = "relivia://auth/callback";

export type NativeAuthResult =
  | { ok: true }
  | { ok: false; error: string };

function dlog(...args: unknown[]): void {
  try {
    // eslint-disable-next-line no-console
    console.debug("[ReliviaNativeAuth]", ...args);
  } catch {
    /* logging must never break auth */
  }
}

/** True only when running inside the APK (Capacitor native). SSR-safe.
 *
 *  Robust by design: selain bridge Capacitor, ikut membaca flag sticky
 *  `rv-is-native` (ditulis app/page.tsx + app/login/page.tsx begitu native
 *  terkonfirmasi — menutup jeda cold-start saat bridge belum di-inject)
 *  dan heuristik UA WebView Android. Versi lama yang hanya cek bridge
 *  bisa me-return false sesaat → login jatuh ke web flow → WebView
 *  dinavigasikan ke supabase.co/accounts.google.com → Android melemparnya
 *  ke Chrome dan sesi tidak pernah kembali ke APK.
 */
export function isNativeSync(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; isNative?: boolean };
    };
    if (w.Capacitor?.isNativePlatform?.() === true) return true;
    if (w.Capacitor?.isNative === true) return true;
    try {
      if (localStorage.getItem("rv-is-native") === "1") return true;
    } catch {
      /* storage unavailable — ignore */
    }
    try {
      const ua = navigator.userAgent || "";
      if (/Android/.test(ua) && /;\s*wv/.test(ua)) return true;
    } catch {
      /* ignore */
    }
    return false;
  } catch {
    return false;
  }
}

/** Persist the sticky native flag for the next cold start (best-effort). */
export function markNativeFlag(): void {
  try {
    localStorage.setItem("rv-is-native", "1");
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * Handle one deep-link URL. Returns true when the URL was an auth callback
 * (handled, success or failure), false when unrelated (e.g. relivia://agent).
 * Always closes the Custom Tab when it handled an auth callback.
 */
export async function consumeNativeAuthCallback(
  supabase: SupabaseClient,
  url: string
): Promise<NativeAuthResult | null> {
  if (!url || !url.startsWith(AUTH_URL_PREFIX)) return null;

  const closeBrowser = async () => {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.close();
    } catch {
      /* best-effort */
    }
  };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    await closeBrowser();
    return { ok: false, error: "Tautan kembali tidak valid. Coba lagi." };
  }

  const oauthError =
    parsed.searchParams.get("error") ?? parsed.hash.match(/error=([^&]+)/)?.[1];
  if (oauthError) {
    dlog("oauth error:", oauthError);
    await closeBrowser();
    const desc =
      parsed.searchParams.get("error_description") ?? "Login Google dibatalkan atau ditolak. Coba lagi.";
    return { ok: false, error: decodeURIComponent(desc.replace(/\+/g, " ")) };
  }

  // Code may arrive in query (?code=) or fragment (#access_token / #code=).
  const code =
    parsed.searchParams.get("code") ?? parsed.hash.match(/code=([^&]+)/)?.[1];
  if (!code) {
    dlog("callback without code");
    await closeBrowser();
    return { ok: false, error: "Login Google gagal — sesi tidak terbentuk. Coba lagi." };
  }

  dlog("exchanging code for session");
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  await closeBrowser();
  if (error) {
    dlog("exchange failed:", error.message);
    // Sertakan pesan asli (mis. "code verifier not found" = state PKCE
    // basi → user cukup retry) supaya tidak retry buta.
    return { ok: false, error: `Login Google gagal — sesi tidak terbentuk (${error.message}). Coba lagi.` };
  }
  dlog("exchange ok");
  return { ok: true };
}

/**
 * Start Google sign-in inside the APK. Resolves once the Custom Tab is OPEN
 * (not when auth completes) — completion arrives via the `appUrlOpen`
 * listener installed by `listenNativeAuthCallback`.
 */
export async function startNativeGoogleSignIn(
  supabase: SupabaseClient
): Promise<NativeAuthResult | null> {
  let Browser: typeof import("@capacitor/browser")["Browser"];
  try {
    ({ Browser } = await import("@capacitor/browser"));
  } catch {
    return { ok: false, error: "Browser native tidak tersedia. Coba login dengan email." };
  }

  dlog("requesting oauth url (skipBrowserRedirect)");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: NATIVE_AUTH_CALLBACK,
      skipBrowserRedirect: true,
    },
  });
  if (error) {
    dlog("signInWithOAuth error:", error.message);
    return { ok: false, error: error.message };
  }
  if (!data?.url) {
    return { ok: false, error: "URL OAuth tidak terbentuk. Coba lagi." };
  }

  try {
    await Browser.open({ url: data.url, presentationStyle: "fullscreen" });
  } catch (e) {
    dlog("Browser.open error:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Gagal membuka browser login. Coba lagi." };
  }
  return null; // opened — wait for appUrlOpen
}

export type NativeAuthCallbacks = {
  onSuccess: () => void;
  onError: (message: string) => void;
  /** Fired when the Custom Tab closes without a session (user cancelled). */
  onCancel?: () => void;
};

/**
 * Install `appUrlOpen` + `browserFinished` listeners. Call once (native only).
 * Returns a cleanup function. Handles both the warm case (appUrlOpen event)
 * and the cold-start case (getLaunchUrl).
 */
export async function listenNativeAuthCallback(
  supabase: SupabaseClient,
  cb: NativeAuthCallbacks
): Promise<() => void> {
  const cleanups: Array<() => void> = [];
  try {
    const { App } = await import("@capacitor/app");
    const { Browser } = await import("@capacitor/browser");

    const handleUrl = async (url: string | null | undefined) => {
      if (!url) return;
      const res = await consumeNativeAuthCallback(supabase, url);
      if (!res) return; // not an auth deep link (e.g. agent link) — ignore
      if (res.ok) cb.onSuccess();
      else cb.onError(res.error);
    };

    const appSub = await App.addListener("appUrlOpen", ({ url }) => {
      dlog("appUrlOpen:", url);
      void handleUrl(url);
    });
    cleanups.push(() => {
      try {
        void appSub.remove();
      } catch {
        /* ignore */
      }
    });

    const browserSub = await Browser.addListener("browserFinished", () => {
      dlog("browserFinished (user may have cancelled)");
      cb.onCancel?.();
    });
    cleanups.push(() => {
      try {
        void browserSub.remove();
      } catch {
        /* ignore */
      }
    });

    // Cold start: app was killed while the Custom Tab was open.
    try {
      const launch = await App.getLaunchUrl();
      const launchUrl = launch?.url;
      if (launchUrl) {
        dlog("launchUrl:", launchUrl);
        void handleUrl(launchUrl);
      }
    } catch {
      /* ignore */
    }
  } catch (e) {
    dlog("listen setup failed:", e instanceof Error ? e.message : e);
  }
  return () => {
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  };
}
