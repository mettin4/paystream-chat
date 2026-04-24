// Generates a new 32-byte entity secret and the RSA-OAEP ciphertext Circle
// Console's "Reset your Entity Secret" dialog needs.
//
// Run with:
//   CIRCLE_API_KEY="TEST_API_KEY:..." npx tsx scripts/generate-entity-secret-ciphertext.ts
//
// Crypto matches Circle's SDK (lib/@circle-fin/developer-controlled-wallets,
// function `US`): RSA-OAEP over the RAW 32 bytes (not the hex string), with
// SHA-256 as both the OAEP hash and MGF1 hash, base64-encoded output.
//
// NOTE ON ONE-SHOT CIPHERTEXTS
// ────────────────────────────
// Circle mandates a unique ciphertext per API request. The one printed below
// is valid for exactly one call — the Console reset counts as that one call.
// Do not reuse it. At runtime the Circle SDK regenerates a fresh ciphertext
// every call from the plaintext you put in .env.local.

import crypto from "node:crypto";
import { existsSync } from "node:fs";

// Load .env.local at startup. Node 20.6+ has this built in, so we don't need
// a dotenv dep. tsx doesn't auto-load env files the way `next dev` does.
if (existsSync(".env.local")) {
  const p = process as typeof process & {
    loadEnvFile?: (path: string) => void;
  };
  if (!p.loadEnvFile) {
    console.error(
      `process.loadEnvFile unavailable (requires Node 20.6+). Your version: ${process.version}.\n` +
        `Either upgrade Node or pass env vars inline:\n` +
        `  CIRCLE_API_KEY="..." npx tsx scripts/generate-entity-secret-ciphertext.ts`
    );
    process.exit(1);
  }
  p.loadEnvFile(".env.local");
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`ERROR: ${name} is not set.`);
    process.exit(1);
  }
  return v;
}

type PublicKeyResponse = {
  data?: { publicKey?: string };
};

async function fetchCirclePublicKey(apiKey: string): Promise<string> {
  const res = await fetch(
    "https://api.circle.com/v1/w3s/config/entity/publicKey",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GET /v1/w3s/config/entity/publicKey failed: ${res.status} ${res.statusText}\n${body}`
    );
  }
  const json = (await res.json()) as PublicKeyResponse;
  const pem = json.data?.publicKey;
  if (!pem || !pem.includes("BEGIN PUBLIC KEY")) {
    throw new Error(
      `Unexpected public key response shape: ${JSON.stringify(json)}`
    );
  }
  return pem;
}

function encryptEntitySecret(
  entitySecretHex: string,
  publicKeyPem: string
): string {
  const rawBytes = Buffer.from(entitySecretHex, "hex");
  if (rawBytes.length !== 32) {
    throw new Error(
      `Entity secret must decode to 32 bytes, got ${rawBytes.length}`
    );
  }
  const ciphertext = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
      // Node uses `oaepHash` for MGF1 too — matches Circle's SDK which sets
      // both `md` and `mgf1.md` to SHA-256.
    },
    rawBytes
  );
  return ciphertext.toString("base64");
}

async function main() {
  const apiKey = requireEnv("CIRCLE_API_KEY");

  // 1. Generate 32-byte entity secret (64 hex chars).
  const entitySecret = crypto.randomBytes(32).toString("hex");

  // 2. Fetch Circle's public key.
  const publicKeyPem = await fetchCirclePublicKey(apiKey);

  // 3. RSA-OAEP encrypt + base64.
  const ciphertext = encryptEntitySecret(entitySecret, publicKeyPem);

  // 4. Print.
  const bar = "─".repeat(64);
  console.log(bar);
  console.log("NEW ENTITY SECRET — save to .env.local as CIRCLE_ENTITY_SECRET:");
  console.log(bar);
  console.log(entitySecret);
  console.log();
  console.log(bar);
  console.log("CIPHERTEXT — paste into Circle Console reset dialog:");
  console.log(bar);
  console.log(ciphertext);
  console.log();
  console.log("Next steps:");
  console.log("  1. Paste the ciphertext into Circle Console's reset dialog.");
  console.log("  2. Upload your recovery_file.dat, click Reset.");
  console.log("  3. Copy the entity secret into .env.local as CIRCLE_ENTITY_SECRET.");
  console.log("  4. Save the entity secret to your password manager NOW.");
  console.log("  5. Save the NEW recovery file Circle generates after the reset.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
