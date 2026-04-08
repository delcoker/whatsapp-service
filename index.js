import express from "express";
import pkg from "whatsapp-web.js";
import qrcodeLib from "qrcode";
import cors from "cors";
import dotenv from "dotenv";

const { Client, LocalAuth } = pkg;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── State ─────────────────────────────────────────────────────────────────────

let currentQR = null;
let clientReady = false;
let isReconnecting = false;
let client = null;

// Serial send queue — prevents concurrent Puppeteer calls
let sendQueue = Promise.resolve();
const queueSend = (fn) => {
  sendQueue = sendQueue.then(fn).catch(() => {});
  return sendQueue;
};

// ── Client factory ────────────────────────────────────────────────────────────

function createClient() {
  const c = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      protocolTimeout: 60000,
    },
  });

  c.on("qr", (qr) => {
    currentQR = qr;
    console.log("📱 QR Code received! Visit /qr to view it");
  });

  c.on("ready", () => {
    console.log("✅ WhatsApp client is ready!");
    currentQR = null;
    clientReady = true;
    isReconnecting = false;
  });

  c.on("auth_failure", () => {
    console.log("❌ Authentication failed");
    clientReady = false;
    scheduleReconnect();
  });

  c.on("disconnected", (reason) => {
    console.log("❌ Client disconnected:", reason);
    clientReady = false;
    scheduleReconnect();
  });

  return c;
}

// ── Reconnect logic ───────────────────────────────────────────────────────────

async function scheduleReconnect() {
  if (isReconnecting) {
    console.log("🔄 Reconnect already in progress, skipping");
    return;
  }
  isReconnecting = true;
  console.log("🔄 Reconnecting in 5 seconds...");

  await new Promise((r) => setTimeout(r, 5000));

  try {
    if (client) {
      try { await client.destroy(); } catch (_) {}
    }

    console.log("🆕 Creating new client instance...");
    client = createClient();
    await client.initialize();
  } catch (err) {
    console.error("💥 Reconnect failed:", err.message);
    isReconnecting = false;
    scheduleReconnect();
  }
}

// ── Unhandled error safety net ────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught exception:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 Unhandled rejection:", reason);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toWhatsAppId(phoneNumber) {
  return phoneNumber.replace(/\D/g, "") + "@c.us";
}

function withTimeout(promise, ms = 45000) {
  const timer = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timer]);
}

async function safeSend(whatsappNumber, text) {
  return new Promise((resolve, reject) => {
    queueSend(async () => {
      try {
        await withTimeout(client.sendMessage(whatsappNumber, text));
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.status(clientReady ? 200 : 503).json({
    status: clientReady ? "ok" : "degraded",
    ready: clientReady,
    reconnecting: isReconnecting,
    timestamp: new Date().toISOString(),
  });
});

app.get("/qr", async (req, res) => {
  try {
    if (!currentQR) {
      return res.status(400).json({
        error: "No QR code available. Already authenticated or waiting...",
      });
    }
    const qrImage = await qrcodeLib.toDataURL(currentQR);
    res.send(`
      <!DOCTYPE html><html>
      <head><title>WhatsApp QR Code</title>
      <style>
        body{display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000;margin:0}
        .container{text-align:center;padding:20px}
        h1{color:#25d366;font-family:Arial}
        img{border:2px solid #25d366;padding:10px;background:white}
        p{color:#888;font-family:Arial}
      </style></head>
      <body><div class="container">
        <h1>📱 Scan with WhatsApp</h1>
        <img src="${qrImage}" alt="WhatsApp QR Code" width="400" height="400">
        <p>Scan this with WhatsApp Settings → Linked Devices → Link a device</p>
      </div></body></html>
    `);
  } catch (error) {
    console.error("❌ Error generating QR:", error);
    res.status(500).json({ error: "Failed to generate QR code", details: error.message });
  }
});

app.post("/send-receipt", async (req, res) => {
  if (!clientReady) {
    return res.status(503).json({ error: "WhatsApp client not ready", reconnecting: isReconnecting });
  }
  const { phoneNumber, receiptText } = req.body;
  if (!phoneNumber || !receiptText) {
    return res.status(400).json({ error: "Missing phoneNumber or receiptText" });
  }
  const whatsappNumber = toWhatsAppId(phoneNumber);
  console.log(`📤 Queuing receipt → ${whatsappNumber}`);
  try {
    await safeSend(whatsappNumber, receiptText);
    res.json({ success: true, message: "Receipt sent successfully", phoneNumber, sentAt: new Date().toISOString() });
  } catch (error) {
    console.error("❌ Error sending receipt:", error.message);
    res.status(500).json({ error: "Failed to send receipt", details: error.message });
  }
});

app.post("/send-message", async (req, res) => {
  if (!clientReady) {
    return res.status(503).json({ error: "WhatsApp client not ready", reconnecting: isReconnecting });
  }
  const { phoneNumber, message } = req.body;
  if (!phoneNumber || !message) {
    return res.status(400).json({ error: "Missing phoneNumber or message" });
  }
  const whatsappNumber = toWhatsAppId(phoneNumber);
  console.log(`📤 Queuing message → ${whatsappNumber}`);
  try {
    await safeSend(whatsappNumber, message);
    res.json({ success: true, message: "Message sent successfully", phoneNumber, sentAt: new Date().toISOString() });
  } catch (error) {
    console.error("❌ Error sending message:", error.message);
    res.status(500).json({ error: "Failed to send message", details: error.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🌐 WhatsApp service running on http://localhost:${PORT}`);
  console.log(`📬 Send receipts to: POST http://localhost:${PORT}/send-receipt`);
  console.log(`📱 View QR code at:  http://localhost:${PORT}/qr`);
});

console.log("🚀 Starting WhatsApp service...");
client = createClient();
client.initialize();

process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  if (client) await client.destroy().catch(() => {});
  process.exit();
});