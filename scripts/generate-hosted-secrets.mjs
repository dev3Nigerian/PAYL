import { randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(bytes) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    output += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return output;
}

function password() {
  return `${randomBytes(18).toString("base64url")}!Aa7`;
}

const consumerEmail = process.env.SANDBOX_CONSUMER_EMAIL ?? "replace-with-your-email@example.com";
const totpSecret = base32(randomBytes(20));
const issuer = encodeURIComponent("PAYL Hosted Sandbox");
const account = encodeURIComponent(consumerEmail);

console.log(`PAYL_SIGNING_MASTER_KEY=${randomBytes(32).toString("base64")}`);
console.log(`SANDBOX_CONSUMER_EMAIL=${consumerEmail}`);
console.log(`SANDBOX_CONSUMER_PASSWORD=${password()}`);
console.log(`SANDBOX_CONSUMER_TOTP_SECRET=${totpSecret}`);
console.log(`SANDBOX_MERCHANT_EMAIL=replace-with-your-merchant-email@example.com`);
console.log(`SANDBOX_MERCHANT_PASSWORD=${password()}`);
console.log(`TOTP_ENROLLMENT_URI=otpauth://totp/${issuer}:${account}?secret=${totpSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`);
console.error("Copy these values into a password manager now. This command does not save them.");
