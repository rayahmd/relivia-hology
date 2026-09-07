import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import AutoMonitorProvider from "@/components/AutoMonitorProvider";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Relivia — Pantau dengan tenang",
  description: "Catatan caregiver harian yang jadi insight klinis untuk psikiater.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={jakarta.variable}>
      <head>
        {/* Native boot guard: runs synchronously during HTML parsing, BEFORE
            first paint and BEFORE React hydration. On Capacitor Android it
            redirects "/" straight to "/login" so the landing page never
            paints. Browsers are unaffected (script exits early).
            - ?code= (OAuth) is left alone for the app's callback forwarder.
            - Only exact "/" is redirected: no loop possible (/login untouched).
            - Sticky flag "rv-is-native" (set by app/page.tsx once native is
              confirmed) covers cold starts where the Capacitor bridge is not
              injected yet at parse time. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=location.search||"";if(s.indexOf("code=")!==-1)return;var p=location.pathname;if(p!=="/"&&p!=="")return;var nat=false;try{if(window.Capacitor&&typeof window.Capacitor.isNativePlatform==="function"){nat=window.Capacitor.isNativePlatform();}if(!nat&&window.Capacitor&&window.Capacitor.isNative===true)nat=true;}catch(e){}if(!nat){try{if(localStorage.getItem("rv-is-native")==="1")nat=true;}catch(e){}}if(!nat){try{var ua=navigator.userAgent||"";if(/Android/.test(ua)&&/;\\s*wv/.test(ua))nat=true;}catch(e){}}if(!nat)return;try{document.documentElement.classList.add("rv-native-boot");}catch(e){}location.replace("/login"+s);}catch(e){}})();`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `html.rv-native-boot,html.rv-native-boot body{background:#2D1B69!important}html.rv-native-boot body{visibility:hidden!important}`,
          }}
        />
      </head>
      <body className="font-sans">
        <AutoMonitorProvider>{children}</AutoMonitorProvider>
      </body>
    </html>
  );
}
