import express from "express";
import pkg from "whatsapp-web.js";
import qrcodeLib from "qrcode";
import cors from "cors";
import dotenv from "dotenv";

const { Client, LocalAuth } = pkg;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Store QR code
let currentQR = null;
let clientReady = false;

// Simple serial message queue — prevents concurrent Puppeteer calls timing out
let sendQueue = Promise.resolve();
const queueSend = (fn) => {
  sendQueue = sendQueue.then(fn).catch(() => {}); // keep chain alive on error
  return sendQueue;
};

// Initialize WhatsApp client with increased protocolTimeout
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    protocolTimeout: 60000, // 60 s — up from default 30 s
  },
});

// Events
client.on("qr", (qr) => {
  currentQR = qr;
  console.log("📱 QR Code received! Visit /qr to view it");
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
  currentQR = null;
  clientReady = true;
});

client.on("disconnected", (reason) => {
  console.log("❌ Client disconnected:", reason);
  clientReady = false;
});

client.on("auth_failure", () => {
  console.log("❌ Authentication failed");
  clientReady = false;
});

// Initialize client
console.log("🚀 Starting WhatsApp service...");
client.initialize();

// ── Helpers ──────────────────────────────────────────────────────────────────

function guardReady(res) {
  if (!clientReady) {
    res.status(503).json({ error: "WhatsApp client not ready yet" });
    return false;
  }
  return true;
}

function toWhatsAppId(phoneNumber) {
  return phoneNumber.replace(/\D/g, "") + "@c.us";
}

async function safeSend(whatsappNumber, text) {
  return new Promise((resolve, reject) => {
    queueSend(async () => {
      try {
        await client.sendMessage(whatsappNumber, text);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", ready: clientReady, timestamp: new Date().toISOString() });
});

// QR Code endpoint — serves as HTML page
app.get("/qr", async (req, res) => {
  try {
    if (!currentQR) {
      return res.status(400).json({
        error: "No QR code available. Already authenticated or waiting...",
      });
    }

    const qrImage = await qrcodeLib.toDataURL(currentQR);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp QR Code</title>
        <style>
          body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; margin: 0; }
          .container { text-align: center; padding: 20px; }
          h1 { color: #25d366; font-family: Arial; }
          img { border: 2px solid #25d366; padding: 10px; background: white; }
          p { color: #888; font-family: Arial; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📱 Scan with WhatsApp</h1>
          <img src="${qrImage}" alt="WhatsApp QR Code" width="400" height="400">
          <p>Scan this with WhatsApp Settings → Linked Devices → Link a device</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ Error generating QR:", error);
    res.status(500).json({ error: "Failed to generate QR code", details: error.message });
  }
});

// Send receipt
app.post("/send-receipt", async (req, res) => {
  if (!guardReady(res)) return;

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
    console.error("❌ Error sending receipt:", error);
    res.status(500).json({ error: "Failed to send receipt", details: error.message });
  }
});

// Send generic message
app.post("/send-message", async (req, res) => {
  if (!guardReady(res)) return;

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
    console.error("❌ Error sending message:", error);
    res.status(500).json({ error: "Failed to send message", details: error.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🌐 WhatsApp service running on http://localhost:${PORT}`);
  console.log(`📬 Send receipts to: POST http://localhost:${PORT}/send-receipt`);
  console.log(`📱 View QR code at:  http://localhost:${PORT}/qr`);
});

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  client.destroy();
  process.exit();
});