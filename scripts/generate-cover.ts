import sharp from "sharp";
import path from "path";

const W = 1920;
const H = 1080;

const BG = "#08090a";
const TEXT = "#f5f5f5";
const MINT = "#10b981";
const MUTED = "#94a3b8";

const FONT = "Helvetica, Arial, sans-serif";

const OUT = path.resolve("docs/cover.png");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <text x="${W / 2}" y="100" fill="${MUTED}" font-family="${FONT}" font-size="20"
        text-anchor="middle" letter-spacing="3">TEAM MTHOCP, AGENTIC ECONOMY ON ARC HACKATHON 2026</text>

  <text x="${W / 2}" y="540" fill="${TEXT}" font-family="${FONT}" font-size="240"
        font-weight="700" text-anchor="middle" letter-spacing="-4">PayStream</text>

  <text x="${W / 2}" y="680" fill="${TEXT}" font-family="${FONT}" font-size="56"
        font-weight="400" text-anchor="middle">Pay per word, not per month.</text>

  <text x="${W / 2}" y="770" fill="${MINT}" font-family="${FONT}" font-size="32"
        font-style="italic" text-anchor="middle">If data streams, money should too.</text>

  <text x="${W - 100}" y="${H - 60}" fill="${MUTED}" font-family="${FONT}" font-size="20"
        text-anchor="end" letter-spacing="1">paystream-chat.vercel.app</text>
</svg>`;

(async () => {
  await sharp(Buffer.from(svg)).png().toFile(OUT);
  console.log(`Wrote ${OUT}`);
})();
