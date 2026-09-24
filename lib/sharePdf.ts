import { isNative } from "@/lib/nativeBridge";
import type { jsPDF } from "jspdf";

/**
 * Save/share a generated PDF.
 *
 * - Web: classic `doc.save()` browser download (unchanged).
 * - Android APK: the Capacitor WebView ignores `<a download>`, so `save()`
 *   silently does nothing. Instead write the file to the app cache and open
 *   the OS share sheet — the caregiver can save it to Files/Drive or send
 *   it via WhatsApp, etc. Cache dir needs no storage permission (Android 10+
 *   scoped storage) and Capacitor's FileProvider serves the URI to the sheet.
 */
export async function saveOrSharePdf(doc: jsPDF, filename: string): Promise<"saved" | "shared"> {
  let native = false;
  try {
    native = await isNative();
  } catch {
    native = false;
  }
  if (!native) {
    doc.save(filename);
    return "saved";
  }

  const dataUri = doc.output("datauristring") as string;
  const base64 = (dataUri.split(",")[1] ?? "").trim();
  if (!base64) throw new Error("Gagal menyiapkan file PDF.");

  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const saved = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });

  const { Share } = await import("@capacitor/share");
  await Share.share({
    title: "Ringkasan Konsultasi",
    text: "Ringkasan konsultasi Relivia",
    url: saved.uri,
    dialogTitle: "Bagikan ringkasan",
  });
  return "shared";
}
