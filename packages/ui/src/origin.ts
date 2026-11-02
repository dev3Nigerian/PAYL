// Only explicit deployment origins are trusted; proxy/Host headers cannot extend this list.
// Keep the Render address working while the custom domain is being verified.
export function hasAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;

  const configured = [process.env.PAYL_PUBLIC_WEB_URL, process.env.RENDER_EXTERNAL_URL].filter(Boolean) as string[];
  if (configured.length === 0 && process.env.NODE_ENV === "production") return false;

  try {
    const allowed = (configured.length ? configured : [request.url]).map((value) => new URL(value));
    return allowed.some((url) => ["http:", "https:"].includes(url.protocol) && origin === url.origin);
  } catch {
    return false;
  }
}
