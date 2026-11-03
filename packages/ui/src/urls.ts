// Resolved on the server at request time, so Render can configure either origin.
export function webUrls() {
  const hosted = process.env.NODE_ENV === "production";
  const consumer = process.env.APPROVAL_WEB_URL ?? (hosted ? "https://antspace.online" : "http://localhost:3000");
  const merchant = process.env.MERCHANT_WEB_URL ?? (hosted ? "https://merchants.antspace.online" : "http://localhost:3001");
  return {
    home: new URL("/", consumer).href,
    consumerDashboard: new URL("/dashboard", consumer).href,
    consumerLogin: new URL("/login", consumer).href,
    merchantDashboard: new URL("/dashboard", merchant).href,
    merchantLogin: new URL("/login", merchant).href,
    merchantRegister: new URL("/register", merchant).href,
  };
}
