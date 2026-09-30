import { createClient as createSsrClient } from "@/lib/supabase/server";
import { createClient as createJsClient } from "@supabase/supabase-js";

/**
 * Resolve the caller for api routes that accept both:
 * 1. browser/webview calls (session cookies via @supabase/ssr), and
 * 2. native workmanager calls (authorization: bearer token — no cookies).
 *
 * returns { supabase, user } or { supabase: null, user: null } when
 * unauthenticated. rls still applies in both paths.
 */
export async function resolveApiAuth(req: Request): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
}> {
  // path 1: cookie session (browser / webview)
  try {
    const ssr = createSsrClient();
    const { data } = await ssr.auth.getUser();
    if (data.user) return { supabase: ssr, user: data.user };
  } catch {
    /* fall through to bearer */
  }

  // path 2: bearer token (native background worker)
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    const client = createJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data, error } = await client.auth.getUser(token);
    if (!error && data.user) {
      const authed = createJsClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      return { supabase: authed, user: data.user };
    }
  }

  return { supabase: null, user: null };
}
