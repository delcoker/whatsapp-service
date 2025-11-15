import express from 'express';
import { Client } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

const client = new Client();

client.on('qr', (qr) => {
    console.log('📱 QR Code received! Scan this with your WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
});

client.on('disconnected', (reason) => {
    console.log('❌ Client disconnected:', reason);
});

console.log('🚀 Starting WhatsApp service...');
client.initialize();

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

app.listen(PORT, () => {
    console.log(`🌐 WhatsApp service running on http://localhost:${PORT}`);
    console.log(`📬 Send receipts to: POST http://localhost:${PORT}/send-receipt`);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    client.destroy();
    process.exit();
});