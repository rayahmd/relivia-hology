import { isNative } from "@/lib/nativeBridge";
import type { jsPDF } from "jspdf";

/**
 * save/share a generated pdf.
 *
 * - web: classic `doc.save()` browser download.
 * - android apk: the webview ignores `<a download>`, so `save()` silently
 *   does nothing. instead write to the app cache and open the os share
 *   sheet. cache dir needs no storage permission (scoped storage) and
 *   capacitor's fileprovider serves the uri to the sheet.
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
