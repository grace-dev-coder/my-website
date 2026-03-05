const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS - ALLOW ALL ORIGINS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many requests. Try again in 15 minutes.' }
});
app.use('/api/contact', limiter);

// Create transporter
const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/\s/g, '') : ''
        },
        tls: { rejectUnauthorized: false }
    });
};

let transporter;
let emailConfigured = false;

const verifyEmail = async () => {
    try {
        transporter = createTransporter();
        await transporter.verify();
        emailConfigured = true;
        console.log('✅ Email server ready');
        return true;
    } catch (err) {
        console.log('⚠️  Email not configured:', err.message);
        return false;
    }
};

const saveToFile = (data) => {
    const dir = path.join(__dirname, 'contacts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `contact_${Date.now()}.json`;
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
    return filename;
};

const validateForm = [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('email').trim().isEmail().normalizeEmail(),
    body('subject').trim().isLength({ min: 2, max: 200 }).escape(),
    body('message').trim().isLength({ min: 10, max: 5000 }).escape()
];

app.post('/api/contact', validateForm, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, email, subject, message } = req.body;
    const timestamp = new Date().toISOString();
    const clientIP = req.ip || req.connection.remoteAddress;

    console.log(`\n📧 New message from ${name} (${email})`);
    console.log(`   Subject: ${subject}`);

    const contactData = { name, email, subject, message, ip: clientIP, timestamp };
    const filename = saveToFile(contactData);
    console.log(`💾 Saved to: contacts/${filename}`);

    if (emailConfigured && process.env.RECEIVER_EMAIL) {
        try {
            await transporter.sendMail({
                from: `"Portfolio" <${process.env.EMAIL_USER}>`,
                to: process.env.RECEIVER_EMAIL,
                replyTo: email,
                subject: `New Contact: ${subject}`,
                html: `<h2>From: ${name} (${email})</h2><p>${message}</p>`
            });
            await transporter.sendMail({
                from: `"Alex Chen" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Thanks for contacting me!',
                html: `<h2>Hi ${name},</h2><p>Thanks for reaching out about "${subject}". I'll reply soon!</p>`
            });
            console.log('✅ Emails sent');
            return res.json({ success: true, message: 'Message sent! Check your email.' });
        } catch (err) {
            console.log('❌ Email failed:', err.message);
        }
    }

    res.json({ 
        success: true, 
        message: 'Message received! (Email not configured - saved to file)',
        saved: true 
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', emailConfigured, timestamp: new Date().toISOString() });
});

app.get('/api/contacts', (req, res) => {
    const dir = path.join(__dirname, 'contacts');
    if (!fs.existsSync(dir)) return res.json({ contacts: [] });
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
        return JSON.parse(fs.readFileSync(path.join(dir, f)));
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ count: files.length, contacts: files });
});

app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not found' });
});

verifyEmail().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🚀 Server running on port ${PORT}`);
        console.log(`📧 Email: ${emailConfigured ? '✅' : '⚠️ File-only mode'}`);
        console.log(`🔗 Endpoints: /api/health, /api/contact, /api/contacts\n`);
    });
});
