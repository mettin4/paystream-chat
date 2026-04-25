import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const W = 1920;
const H = 1080;

const BG = "#08090a";
const TEXT = "#f5f5f5";
const MINT = "#10b981";
const MUTED = "#94a3b8";
const PANEL = "#101214";
const BORDER = "#1f242a";

const OUT = path.resolve("docs/pitch-deck.pdf");
const SCREENSHOT = path.resolve("docs/screenshot.png");

const doc = new PDFDocument({
  size: [W, H],
  margin: 0,
  autoFirstPage: false,
  info: {
    Title: "PayStream Pitch Deck",
    Author: "Team MTHOCP",
    Subject: "Agentic Economy on Arc Hackathon 2026",
  },
});

doc.pipe(fs.createWriteStream(OUT));

function paintBackground() {
  doc.rect(0, 0, W, H).fill(BG);
}

function newSlide() {
  doc.addPage({ size: [W, H], margin: 0 });
  paintBackground();
}

function topLabel(text: string) {
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(18)
    .text(text, 100, 80, { characterSpacing: 2 });
}

function pageNumber(n: number) {
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(14)
    .text(`0${n} / 06`, W - 200, H - 80, {
      width: 100,
      align: "right",
      characterSpacing: 2,
    });
}

function footerBrand() {
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(14)
    .text("PAYSTREAM", 100, H - 80, { characterSpacing: 3 });
}

// Slide 1 — Title
newSlide();
topLabel("TEAM MTHOCP, AGENTIC ECONOMY ON ARC HACKATHON 2026");

doc
  .fillColor(TEXT)
  .font("Helvetica-Bold")
  .fontSize(220)
  .text("PayStream", 0, 360, { width: W, align: "center", characterSpacing: -4 });

doc
  .fillColor(TEXT)
  .font("Helvetica")
  .fontSize(56)
  .text("Pay per word, not per month.", 0, 660, { width: W, align: "center" });

doc
  .fillColor(MINT)
  .font("Helvetica-Oblique")
  .fontSize(28)
  .text("If data streams, money should too.", 0, 760, { width: W, align: "center" });

// small mint underline accent in lower right
doc.rect(W - 220, H - 120, 60, 3).fill(MINT);
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(14)
  .text("01 / 06", W - 200, H - 80, {
    width: 100,
    align: "right",
    characterSpacing: 2,
  });

// Slide 2 — The problem
newSlide();
topLabel("THE PROBLEM");

doc
  .fillColor(TEXT)
  .font("Helvetica-Bold")
  .fontSize(80)
  .text("Subscription billing doesn't fit AI", 100, 220, {
    width: W - 200,
    characterSpacing: -1,
  });

doc.moveTo(100, 360).lineTo(260, 360).lineWidth(3).strokeColor(MINT).stroke();

const problemLines = [
  "Flat monthly fees waste capacity for most users.",
  "Card networks can't process payments under a cent.",
  "Per-token pricing has no rail to settle on.",
];

let py = 460;
for (const line of problemLines) {
  doc
    .fillColor(TEXT)
    .font("Helvetica")
    .fontSize(40)
    .text(line, 100, py, { width: W - 200 });
  py += 90;
}

doc
  .fillColor(MUTED)
  .font("Helvetica-Oblique")
  .fontSize(28)
  .text("Streaming output deserves streaming payment.", 100, H - 200, {
    width: W - 200,
  });

footerBrand();
pageNumber(2);

// Slide 3 — The solution
newSlide();
topLabel("THE SOLUTION");

doc
  .fillColor(TEXT)
  .font("Helvetica-Bold")
  .fontSize(120)
  .text("PayStream", 100, 180, { characterSpacing: -2 });

doc.rect(100, 340, 80, 4).fill(MINT);

doc
  .fillColor(TEXT)
  .font("Helvetica")
  .fontSize(36)
  .text(
    "$0.0001 USDC per word the model writes, settled on chain in real time.",
    100,
    400,
    { width: W - 200 }
  );

// Three blocks
const blockY = 600;
const blockH = 280;
const blockGap = 40;
const blockW = (W - 200 - blockGap * 2) / 3;

const blocks = [
  { tag: "PER WORD", body: "$0.0001 USDC each" },
  { tag: "ON CHAIN", body: "Arc Testnet, sub-second finality" },
  { tag: "STOP TO STOP", body: "End the stream, end the bill" },
];

blocks.forEach((b, i) => {
  const x = 100 + i * (blockW + blockGap);
  doc
    .roundedRect(x, blockY, blockW, blockH, 8)
    .lineWidth(1)
    .strokeColor(BORDER)
    .fillAndStroke(PANEL, BORDER);

  doc
    .fillColor(MINT)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(b.tag, x + 40, blockY + 50, {
      width: blockW - 80,
      characterSpacing: 3,
    });

  doc
    .fillColor(TEXT)
    .font("Helvetica")
    .fontSize(32)
    .text(b.body, x + 40, blockY + 130, { width: blockW - 80 });
});

footerBrand();
pageNumber(3);

// Slide 4 — How it works
newSlide();
topLabel("HOW IT WORKS");

doc
  .fillColor(TEXT)
  .font("Helvetica-Bold")
  .fontSize(64)
  .text("Streaming words, streaming payment.", 100, 200, {
    width: W - 200,
    characterSpacing: -1,
  });

doc.rect(100, 320, 80, 4).fill(MINT);

// Architecture diagram
// Row 1: Browser -> Next.js -> Anthropic Claude Haiku
// Row 2 (branches from Next.js): Circle Nanopayment Batcher -> Circle Gateway -> Arc Testnet

const nodeH = 110;
const row1Y = 440;
const row2Y = 700;

type Node = { x: number; y: number; w: number; label: string; sub?: string };

const nodeWLg = 360;
const nodeWMd = 320;

const browser: Node = { x: 100, y: row1Y, w: nodeWMd, label: "Browser" };
const apiChat: Node = {
  x: 100 + nodeWMd + 100,
  y: row1Y,
  w: nodeWMd,
  label: "Next.js",
  sub: "/api/chat",
};
const claude: Node = {
  x: 100 + (nodeWMd + 100) * 2,
  y: row1Y,
  w: nodeWLg,
  label: "Anthropic",
  sub: "Claude Haiku",
};

const batcher: Node = {
  x: 100 + nodeWMd + 100,
  y: row2Y,
  w: nodeWLg,
  label: "Circle Nanopayment",
  sub: "Batcher",
};
const gateway: Node = {
  x: 100 + nodeWMd + 100 + nodeWLg + 80,
  y: row2Y,
  w: nodeWLg + 40,
  label: "Circle Gateway",
  sub: "Arc Testnet 5042002",
};

function drawNode(n: Node) {
  doc
    .roundedRect(n.x, n.y, n.w, nodeH, 8)
    .lineWidth(1)
    .strokeColor(BORDER)
    .fillAndStroke(PANEL, BORDER);

  if (n.sub) {
    doc
      .fillColor(TEXT)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(n.label, n.x + 24, n.y + 26, { width: n.w - 48 });
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(16)
      .text(n.sub, n.x + 24, n.y + 62, { width: n.w - 48 });
  } else {
    doc
      .fillColor(TEXT)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(n.label, n.x + 24, n.y + 42, { width: n.w - 48 });
  }
}

function arrowH(x1: number, x2: number, y: number) {
  doc.moveTo(x1, y).lineTo(x2 - 16, y).lineWidth(1.5).strokeColor(MINT).stroke();
  // arrowhead
  doc
    .moveTo(x2, y)
    .lineTo(x2 - 14, y - 7)
    .lineTo(x2 - 14, y + 7)
    .closePath()
    .fillColor(MINT)
    .fill();
}

function arrowDown(x: number, y1: number, y2: number) {
  doc.moveTo(x, y1).lineTo(x, y2 - 16).lineWidth(1.5).strokeColor(MINT).stroke();
  doc
    .moveTo(x, y2)
    .lineTo(x - 7, y2 - 14)
    .lineTo(x + 7, y2 - 14)
    .closePath()
    .fillColor(MINT)
    .fill();
}

drawNode(browser);
drawNode(apiChat);
drawNode(claude);
drawNode(batcher);
drawNode(gateway);

// arrows row 1
arrowH(browser.x + browser.w, apiChat.x, row1Y + nodeH / 2);
arrowH(apiChat.x + apiChat.w, claude.x, row1Y + nodeH / 2);

// branch down from apiChat to batcher
arrowDown(apiChat.x + apiChat.w / 2, row1Y + nodeH, row2Y);

// arrow batcher -> gateway
arrowH(batcher.x + batcher.w, gateway.x, row2Y + nodeH / 2);

// labels on arrows
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(14)
  .text("prompt", browser.x + browser.w + 18, row1Y + nodeH / 2 - 28, {
    width: 100 - 18,
  });
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(14)
  .text("stream", apiChat.x + apiChat.w + 18, row1Y + nodeH / 2 - 28, {
    width: 100 - 18,
  });
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(14)
  .text("per word", apiChat.x + apiChat.w / 2 + 12, row1Y + nodeH + 60, {
    width: 140,
  });
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(14)
  .text("settle batch", batcher.x + batcher.w + 18, row2Y + nodeH / 2 - 28, {
    width: 100,
  });

// Caption below
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(22)
  .text(
    "Each word triggers an EIP-3009 authorization signed via a Circle Developer-Controlled Wallet. Gateway batches and settles on Arc.",
    100,
    900,
    { width: W - 200 }
  );

footerBrand();
pageNumber(4);

// Slide 5 — Demo
newSlide();
topLabel("DEMO");

doc
  .fillColor(TEXT)
  .font("Helvetica-Bold")
  .fontSize(48)
  .text("Live at paystream-chat.vercel.app", 0, 160, {
    width: W,
    align: "center",
  });

// Embed screenshot, scaled down
// Source: 1919 x 1021. Fit centered with frame.
const targetW = 1280;
const aspect = 1021 / 1919;
const targetH = Math.round(targetW * aspect);
const sx = (W - targetW) / 2;
const sy = 260;

// Subtle border frame
doc
  .roundedRect(sx - 6, sy - 6, targetW + 12, targetH + 12, 8)
  .lineWidth(1)
  .strokeColor(BORDER)
  .stroke();

doc.image(SCREENSHOT, sx, sy, { width: targetW, height: targetH });

doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(22)
  .text(
    "Real Circle Nanopayments, real Arc Testnet settlements.",
    0,
    sy + targetH + 50,
    { width: W, align: "center" }
  );

footerBrand();
pageNumber(5);

// Slide 6 — Why this matters
newSlide();
topLabel("WHY THIS MATTERS");

doc
  .fillColor(TEXT)
  .font("Helvetica-Bold")
  .fontSize(80)
  .text("Built for the agentic economy", 100, 220, {
    width: W - 200,
    characterSpacing: -1,
  });

doc.rect(100, 360, 80, 4).fill(MINT);

const points = [
  "100+ on-chain authorizations per typical chat response.",
  "Sub-cent pricing, real settlement.",
  "Custom W3S to x402 adapter that makes the integration work.",
];

let wy = 460;
for (const p of points) {
  doc
    .fillColor(TEXT)
    .font("Helvetica")
    .fontSize(36)
    .text(p, 100, wy, { width: W - 200 });
  wy += 90;
}

// Bottom info bar
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(18)
  .text("github.com/mettin4/paystream-chat", 100, H - 130, {
    characterSpacing: 1,
  });

doc
  .fillColor(MINT)
  .font("Helvetica-Bold")
  .fontSize(18)
  .text("TEAM MTHOCP", W - 300, H - 130, {
    width: 200,
    align: "right",
    characterSpacing: 3,
  });

doc.moveTo(100, H - 90).lineTo(W - 100, H - 90).lineWidth(1).strokeColor(BORDER).stroke();

doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(14)
  .text("PAYSTREAM", 100, H - 60, { characterSpacing: 3 });
doc
  .fillColor(MUTED)
  .font("Helvetica")
  .fontSize(14)
  .text("06 / 06", W - 200, H - 60, {
    width: 100,
    align: "right",
    characterSpacing: 2,
  });

doc.end();

console.log(`Wrote ${OUT}`);
