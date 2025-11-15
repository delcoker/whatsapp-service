import express from 'express';
import { Client } from 'whatsapp-web.js';
import qrcodeLib from 'qrcode';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Store QR code
let currentQR = null;

// Initialize WhatsApp client with Puppeteer options
const client = new Client({
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Events
client.on('qr', (qr) => {
    currentQR = qr;
    console.log('📱 QR Code received! Visit /qr to view it');
});

client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    currentQR = null;
});

client.on('disconnected', (reason) => {
    console.log('❌ Client disconnected:', reason);
});

client.on('auth_failure', () => {
    console.log('❌ Authentication failed');
});

// Initialize client
console.log('🚀 Starting WhatsApp service...');
client.initialize();

// Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// QR Code endpoint - serves as image
app.get('/qr', async (req, res) => {
    try {
        if (!currentQR) {
            return res.status(400).json({
                error: 'No QR code available. Already authenticated or waiting...'
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
        console.error('❌ Error generating QR:', error);
        res.status(500).json({
            error: 'Failed to generate QR code',
            details: error.message
        });
    }
});

// Send receipt endpoint
app.post('/send-receipt', async (req, res) => {
    try {
        const { phoneNumber, receiptText } = req.body;

        if (!phoneNumber || !receiptText) {
            return res.status(400).json({
                error: 'Missing phoneNumber or receiptText'
            });
        }

        const whatsappNumber = phoneNumber.replace(/\D/g, '') + '@c.us';

        console.log(`📤 Sending receipt to ${whatsappNumber}`);
        await client.sendMessage(whatsappNumber, receiptText);

        res.json({
            success: true,
            message: 'Receipt sent successfully',
            phoneNumber,
            sentAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error sending receipt:', error);
        res.status(500).json({
            error: 'Failed to send receipt',
            details: error.message
        });
    }
});

// Generic send message endpoint
app.post('/send-message', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                error: 'Missing phoneNumber or message'
            });
        }

        const whatsappNumber = phoneNumber.replace(/\D/g, '') + '@c.us';

        console.log(`📤 Sending message to ${whatsappNumber}`);
        await client.sendMessage(whatsappNumber, message);

        res.json({
            success: true,
            message: 'Message sent successfully',
            phoneNumber,
            sentAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error sending message:', error);
        res.status(500).json({
            error: 'Failed to send message',
            details: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🌐 WhatsApp service running on http://localhost:${PORT}`);
    console.log(`📬 Send receipts to: POST http://localhost:${PORT}/send-receipt`);
    console.log(`📱 View QR code at: http://localhost:${PORT}/qr`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    client.destroy();
    process.exit();
});