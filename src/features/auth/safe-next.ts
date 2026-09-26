/**
 * Safe post-login redirect: only same-origin app paths. Parses with the URL parser (which strips
 * tab/CR/LF, e.g. "/\t/evil.example" → "//evil.example") and compares origins.
 */
export function safeNext(value: string | null, origin = typeof window === "undefined" ? "http://localhost" : window.location.origin): string {
  if (!value || !value.startsWith("/") || /[\u0000-\u001F\u007F\\]/.test(value)) return "/projects";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return "/projects";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/projects";
  }
}
