export function hasAllowedOrigin(request: Request): boolean {
  const publicUrl = process.env.PAYL_PUBLIC_WEB_URL || process.env.RENDER_EXTERNAL_URL || request.url;
  return request.headers.get("origin") === new URL(publicUrl).origin;
}
