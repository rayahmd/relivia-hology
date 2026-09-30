import { redirect } from "next/navigation";

/**
 * / — no landing page (mobile-app focus). Authenticated users land on
 * /dashboard; unauthenticated users never reach here (middleware sends
 * them to /login). The ?code= forward is an OAuth safety net: if Supabase
 * redirects the auth code to the Site URL (root) instead of
 * /auth/callback, pass it through so the session exchange still runs.
 */
export default function RootPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  if (typeof searchParams.code === "string" && searchParams.code) {
    redirect(`/auth/callback?code=${encodeURIComponent(searchParams.code)}`);
  }
  redirect("/dashboard");
}
