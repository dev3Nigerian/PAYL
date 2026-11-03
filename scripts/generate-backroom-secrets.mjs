import { randomBytes } from "node:crypto";

if (process.argv.includes("--help")) {
  console.log("Usage: pnpm backroom:secrets\nGenerates an owner password and authenticator setup key locally. Set PAYL_BACKROOM_EMAIL separately on the API service. Keep both generated values private.");
} else {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...randomBytes(20)].map((value) => value.toString(2).padStart(8, "0")).join("");
  let secret = "";
  for (let index = 0; index < bits.length; index += 5) secret += alphabet[Number.parseInt(bits.slice(index, index + 5), 2)];
  console.log("# Private owner credentials. Store in your password manager; do not commit or share.");
  console.log(`PAYL_BACKROOM_PASSWORD=${randomBytes(24).toString("base64url")}`);
  console.log(`PAYL_BACKROOM_TOTP_SECRET=${secret}`);
  console.log("\n# Add the TOTP secret manually to an authenticator app: Antspace Backroom, time-based, 6 digits, 30 seconds, SHA-1.");
  console.log("# Set PAYL_BACKROOM_EMAIL to a separate owner email. Add all three variables to the API service only, then redeploy.");
}
