export function extractFileIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("id")) {
      return parsed.searchParams.get("id");
    }

    // Match /file/d/<id>/ or /document/d/<id>/
    const segments = parsed.pathname.split("/");
    const index = segments.indexOf("d");
    if (index >= 0 && segments.length > index + 1) {
      return segments[index + 1];
    }

    return null;
  } catch {
    return null;
  }
}
