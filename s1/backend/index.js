require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const path = require('path');

// Polyfill AbortSignal.timeout for Node < 17.3
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = function(ms) {
    const controller = new AbortController();
    setTimeout(function() { controller.abort(); }, ms);
    return controller.signal;
  };
}

// --------------- Groq LLM (primary — free tier: 30 RPM, 14400 RPD) ---------------
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

// --------------- Gemini LLM fallback ---------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

// --------------- SambaNova LLM fallback (free tier, OpenAI-compatible) ---------------
const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY || '';
const SAMBANOVA_MODEL = process.env.SAMBANOVA_MODEL || 'Meta-Llama-3.1-70B-Instruct';

// --------------- OpenWeatherMap API Key ---------------
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || '';

// Database: MongoDB if MONGODB_URI is set, otherwise SQLite (local)
const databaseType = (process.env.DATABASE_TYPE || 'sqlite').toLowerCase();
if (!['sqlite', 'mongodb'].includes(databaseType)) {
  throw new Error(`Unsupported DATABASE_TYPE "${databaseType}". Use "sqlite" or "mongodb".`);
}
if (databaseType === 'mongodb' && !process.env.MONGODB_URI) {
  throw new Error('DATABASE_TYPE=mongodb requires MONGODB_URI to be configured.');
}
const dbModule = databaseType === 'mongodb' ? './db-mongo' : './db';
console.log(`Database: ${databaseType === 'mongodb' ? 'MongoDB Atlas' : 'SQLite'}`);
const { getDb, save, flushSave, createUser, findUserByEmail, saveDiseaseReport, getUserReports, saveSoilInquiry, getUserSoilInquiries, saveCropRecommendation, getUserCropRecommendations, createResetToken, findValidResetToken, markTokenUsed, updateUserPassword, updateUserProfile, saveAuthToken, findAuthToken, deleteAuthToken, deleteAuthTokensByEmail, purgeExpiredAuthTokens } = require(dbModule);
const { coordinateCropAndFertilizer, CROP_PROFILES } = require('./crop-fertilizer-agent');
const CROP_DISEASE_DATA = require('../crop_disease_data.json');
const KARNATAKA_FERTILIZER_SHOPS = require('../karnataka_fertilizer_shops.json');

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Trust reverse proxies (Render, ngrok) so req.ip = real client IP, not proxy IP
if (IS_PROD) app.set('trust proxy', 1);

// --------------- Token helpers (persistent in SQLite/PostgreSQL) ---------------
async function generateToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await saveAuthToken(token, userId, expiresAt);
  return token;
}

async function verifyToken(token) {
  return await findAuthToken(token);
}

// --------------- Rate limiter (in-memory, per-IP, per-endpoint) ---------------
const rateLimitMaps = [];

function rateLimit(windowMs, maxRequests) {
  const map = new Map();
  rateLimitMaps.push(map);
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = map.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { windowStart: now, count: 0 };
      map.set(key, entry);
    }
    entry.count++;
    if (entry.count > maxRequests) {
      return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// Clean up rate limit maps every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const map of rateLimitMaps) {
    for (const [key, entry] of map) {
      if (now - entry.windowStart > 300000) map.delete(key);
    }
  }
  // Purge expired auth tokens from DB
  try { purgeExpiredAuthTokens().catch(() => {}); } catch { /* db not ready yet */ }
}, 300000);

// --------------- Auth middleware ---------------
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  const userId = await verifyToken(token);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
  req.userId = userId;
  next();
}

// --------------- Email Transporter (Nodemailer + Gmail) ---------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

const emailConfigured = !!(process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD && !process.env.SMTP_EMAIL.includes('your-'));

// Verify email config on startup (non-blocking)
if (emailConfigured) {
  transporter.verify()
    .then(() => console.log('Email service: READY'))
    .catch(err => console.warn('Email service: FAILED -', err.message));
} else {
  console.log('Email service: NOT CONFIGURED (set SMTP_EMAIL and SMTP_PASSWORD in .env)');
}

async function sendOtpEmail(toEmail, otp) {
  const mailOptions = {
    from: `"SmartAgriCare" <${process.env.SMTP_EMAIL}>`,
    replyTo: process.env.SMTP_EMAIL,
    to: toEmail,
    subject: 'Your password reset code',
    headers: {
      'X-Priority': '1',
      'List-Unsubscribe': `<mailto:${process.env.SMTP_EMAIL}?subject=unsubscribe>`,
    },
    text: `Your SmartAgriCare password reset code is: ${otp}\n\nThis code expires in 15 minutes.\nIf you didn't request this, please ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #3D5A1E; margin: 0;">SmartAgriCare</h2>
          <p style="color: #666; font-size: 14px;">Password Reset</p>
        </div>
        <div style="background: #f5f3ef; border-radius: 12px; padding: 24px; text-align: center;">
          <p style="color: #333; font-size: 14px; margin-bottom: 16px;">Your password reset code is:</p>
          <div style="background: #fff; border: 2px solid #6B8F3C; border-radius: 8px; padding: 16px; display: inline-block;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #3D5A1E;">${otp}</span>
          </div>
          <p style="color: #888; font-size: 12px; margin-top: 16px;">This code expires in 15 minutes.<br>If you didn't request this, ignore this email.</p>
        </div>
      </div>
    `,
  };
  return transporter.sendMail(mailOptions);
}

// --------------- Graceful shutdown — flush DB on exit ---------------
function shutdown(signal) {
  console.log(`\n${signal} received. Flushing database...`);
  flushSave();
  console.log('Database saved. Exiting.');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Fatal errors: log but keep running in development, exit in production
process.on('uncaughtException', (err) => {
  console.error('FATAL uncaught exception:', err);
  try { flushSave(); } catch { /* best effort */ }
  if (IS_PROD) process.exit(1);
  // In dev: log and continue — prevents the server from dying on transient errors
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  // Don't exit for promise rejections — usually recoverable
});
// Windows: handle Ctrl+C properly (SIGINT sometimes missed on Windows)
if (process.platform === 'win32') {
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}
// Last-resort save on exit (handles Windows terminal close)
process.on('exit', () => {
  try { flushSave(); } catch { /* best effort */ }
});
// Auto-save DB every 60 seconds as safety net
setInterval(() => { save(); }, 60000);

// --------------- Middleware ---------------
// Security headers
app.use(helmet({
  contentSecurityPolicy: false,  // CSP breaks inline styles/scripts from Vite
  crossOriginEmbedderPolicy: false,
}));
// CORS: in production same-origin (no Origin header = same-origin, so deny cross-origin),
// in dev allow configured origins + ngrok tunnels
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:8080', 'http://localhost:5173'];
app.use(cors({
  origin: (origin, cb) => {
    // No Origin header = same-origin request (browser) or non-browser client — allow
    if (!origin) return cb(null, true);
    // Android WebView sends Origin: "null" (the literal string) — allow it
    if (origin === 'null') return cb(null, true);
    // In production, allow same Render URL + file:// origins (mobile WebView)
    if (IS_PROD) {
      const renderUrl = process.env.RENDER_EXTERNAL_URL;
      if (renderUrl && origin === renderUrl) return cb(null, true);
      // Allow file:// origins (Capacitor/Cordova/WebView apps)
      if (origin.startsWith('file://')) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    }
    // Dev: allow configured origins + any localhost port + ngrok tunnels
    if (corsOrigins.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin) || origin.endsWith('.ngrok-free.dev') || origin.endsWith('.ngrok.io')) {
      cb(null, true);
    } else {
      console.warn(`CORS blocked request from origin: ${origin}`);
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use((req, _res, next) => { if (!IS_PROD || req.url.startsWith('/api/')) console.log(`${new Date().toISOString()} ${req.method} ${req.url.split('?')[0]}`); next(); });

// --------------- AP Crop Database ---------------
// Only crops that have images in the image/crops folder
const CROPS_WITH_IMAGES = [
  'Rice', 'Paddy', 'Cotton', 'Maize', 'Corn', 'Banana', 'Coconut', 'Mango',
  'Watermelon', 'Muskmelon', 'Black Gram', 'Urad', 'Green Gram', 'Moong',
  'Red Gram', 'Tur Dal', 'Chickpea', 'Bengal Gram', 'Lentil', 'Kidneybeans',
  'Mothbeans', 'Jute', 'Grapes', 'Orange', 'Papaya', 'Pomegranate', 'Apple', 'Coffee'
];

const AP_CROPS = [
  // ── Kharif crops ──
  { name: 'Paddy (Rice)', season: 'Kharif', soils: ['Alluvial', 'Clay', 'Black Cotton', 'Coastal Saline'], water: 'High', period: '120-150 days', yield: '30-60 q/ha', districts: ['East Godavari', 'West Godavari', 'Krishna', 'Guntur', 'Prakasam', 'Nellore', 'Srikakulam', 'Vizianagaram', 'Visakhapatnam', 'Kakinada', 'Konaseema', 'Bapatla', 'Eluru', 'NTR', 'Anakapalli'], sowing: 'June-July', harvest: 'Oct-Nov', fertilizer: 'NPK 150:60:60 + ZnSO₄ 25 kg/ha', emoji: '🌾', varieties: ['BPT-5204 (Samba Masuri)', 'MTU-1010', 'MTU-7029', 'Swarna', 'NLR-34449', 'Pushyami', 'CSR-36 (saline)'], msp: '₹2,300/qtl', intercrops: ['Greengram', 'Vegetables (tomato, chilli)'], image: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=400&q=80', phRange: '6.0-7.5', rainfall: '1200-1500 mm' },
  { name: 'Cotton', season: 'Kharif', soils: ['Black Cotton', 'Red', 'Alluvial'], water: 'Moderate', period: '150-180 days', yield: '15-20 q/ha', districts: ['Guntur', 'Kurnool', 'Prakasam', 'Anantapur', 'Kadapa', 'Nandyal', 'Sri Sathya Sai', 'Vizianagaram', 'Srikakulam'], sowing: 'June-July', harvest: 'Nov-Jan', fertilizer: 'NPK 120:60:60 kg/ha', emoji: '🏵️', varieties: ['Khandwa-2', 'Bunny Bt', 'Suraj', 'NHH-44'], msp: '₹7,121/qtl (long staple)', intercrops: ['Blackgram', 'Redgram (tur)'], image: 'https://images.unsplash.com/photo-1605000797499-95a51c5269ae?w=400&q=80', phRange: '6.0-8.0', rainfall: '500-700 mm' },
  { name: 'Groundnut', season: 'Kharif', soils: ['Red', 'Sandy', 'Laterite'], water: 'Low', period: '100-130 days', yield: '10-25 q/ha', districts: ['Anantapur', 'Kurnool', 'Chittoor', 'Kadapa', 'Prakasam', 'Nellore', 'Sri Sathya Sai', 'Srikakulam', 'Nandyal', 'Tirupati'], sowing: 'June-July', harvest: 'Sep-Oct', fertilizer: 'NPK 20:50:25 + Gypsum 200 kg/ha', emoji: '🥜', varieties: ['TAG-24', 'TMV-7', 'Nidhi', 'RMG-492', 'TG-37A', 'ICGS-76'], msp: '₹6,377/qtl', intercrops: ['Castor', 'Redgram'], image: 'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=400&q=80', phRange: '6.5-7.0', rainfall: '500-700 mm' },
  { name: 'Maize', season: 'Kharif', soils: ['Alluvial', 'Red', 'Black Cotton'], water: 'Moderate', period: '90-110 days', yield: '45-80 q/ha', districts: ['Guntur', 'Krishna', 'West Godavari', 'Prakasam', 'Kurnool', 'Srikakulam', 'Nandyal', 'Visakhapatnam'], sowing: 'June-July', harvest: 'Sep-Oct', fertilizer: 'NPK 150:60:30 kg/ha', emoji: '🌽', varieties: ['DHM-117', 'Pioneer hybrids', 'Dekalb'], msp: '₹2,090/qtl', intercrops: ['Blackgram', 'Greengram'], image: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=400&q=80', phRange: '5.5-7.5', rainfall: '550-750 mm' },
  { name: 'Red Gram (Tur Dal)', season: 'Kharif', soils: ['Red', 'Black Cotton', 'Laterite'], water: 'Low', period: '150-180 days', yield: '8-12 q/ha', districts: ['Kurnool', 'Prakasam', 'Guntur', 'Anantapur', 'Kadapa', 'Nandyal', 'Vizianagaram'], sowing: 'June-July', harvest: 'Dec-Jan', fertilizer: 'NPK 20:50:20 kg/ha + Rhizobium', emoji: '🫘', varieties: ['LRG-41', 'ICPL-87119 (Asha)', 'Maruti', 'Kadapa Srisailam'], msp: '₹7,000/qtl', intercrops: ['Sorghum', 'Cotton'], image: 'https://images.unsplash.com/photo-1585011664466-b7bbe92f34ef?w=400&q=80', phRange: '6.0-7.5', rainfall: '600-700 mm' },
  { name: 'Green Gram (Moong)', season: 'Kharif', soils: ['Red', 'Sandy', 'Alluvial'], water: 'Low', period: '60-75 days', yield: '8-10 q/ha', districts: ['Anantapur', 'Kurnool', 'Prakasam', 'Nellore', 'Kadapa', 'Srikakulam', 'Vizianagaram'], sowing: 'June-July', harvest: 'Aug-Sep', fertilizer: 'NPK 20:40:20 kg/ha', emoji: '🌿', varieties: ['LGG-407', 'LGG-460', 'IPM-02-3'], msp: '₹8,558/qtl', intercrops: ['Maize', 'Bajra'], image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', phRange: '6.0-7.5', rainfall: '300-500 mm' },
  { name: 'Chillies', season: 'Kharif', soils: ['Black Cotton', 'Red', 'Alluvial'], water: 'Moderate', period: '150-180 days', yield: '15-20 q/ha (dry)', districts: ['Guntur', 'Prakasam', 'Krishna', 'Srikakulam', 'Bapatla'], sowing: 'June-Aug', harvest: 'Nov-Feb', fertilizer: 'NPK 120:60:60 kg/ha', emoji: '🌶️', varieties: ['Guntur Sannam (S-4)', 'Byadgi', 'LCA-334', 'Pusa Jwala'], msp: '₹8,000-12,000/qtl (market)', intercrops: [], image: 'https://images.unsplash.com/photo-1588252303782-cb80119abd6d?w=400&q=80', phRange: '6.0-7.0', rainfall: '600-1200 mm' },
  { name: 'Sugarcane', season: 'Kharif', soils: ['Alluvial', 'Black Cotton', 'Clay'], water: 'High', period: '300-365 days', yield: '800-1000 q/ha', districts: ['East Godavari', 'West Godavari', 'Visakhapatnam', 'Krishna', 'Srikakulam', 'Kakinada', 'Konaseema'], sowing: 'Jan-Mar', harvest: 'Dec-Mar', fertilizer: 'NPK 250:100:120 kg/ha', emoji: '🎋', varieties: ['Co-86032', 'CoV-92102', '93A-11', 'CoA-92081'], msp: '₹315/qtl (FRP)', intercrops: [], image: 'https://images.unsplash.com/photo-1527847263472-aa5338d178b8?w=400&q=80', phRange: '6.0-8.0', rainfall: '1200-1500 mm' },
  { name: 'Turmeric', season: 'Kharif', soils: ['Alluvial', 'Red', 'Clay'], water: 'Moderate', period: '210-240 days', yield: '200-250 q/ha (fresh)', districts: ['Kadapa', 'Guntur', 'East Godavari', 'West Godavari', 'Prakasam'], sowing: 'May-June', harvest: 'Jan-Mar', fertilizer: 'NPK 60:30:120 kg/ha', emoji: '🟡', varieties: ['Duggirala', 'Mydukur', 'Armoor'], msp: '₹5,000-10,000/qtl (market)', intercrops: ['Onion (sand)'], image: 'https://images.unsplash.com/photo-1615485500704-8e990f9900f7?w=400&q=80', phRange: '5.5-7.5', rainfall: '1000-1500 mm' },
  { name: 'Jowar (Sorghum)', season: 'Kharif', soils: ['Black Cotton', 'Red', 'Laterite'], water: 'Low', period: '100-120 days', yield: '25-35 q/ha', districts: ['Kurnool', 'Anantapur', 'Prakasam', 'Kadapa', 'Nandyal'], sowing: 'June-July', harvest: 'Oct-Nov', fertilizer: 'NPK 80:40:40 kg/ha', emoji: '🌾', varieties: ['CSH-16', 'CSV-15', 'Maldandi'], msp: '₹3,180/qtl', intercrops: ['Redgram'], image: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=400&q=80', phRange: '6.0-8.0', rainfall: '400-600 mm' },
  { name: 'Bajra (Pearl Millet)', season: 'Kharif', soils: ['Sandy', 'Red', 'Laterite'], water: 'Low', period: '75-90 days', yield: '15-20 q/ha', districts: ['Anantapur', 'Kurnool', 'Prakasam', 'Chittoor', 'Srikakulam', 'Sri Sathya Sai'], sowing: 'June-July', harvest: 'Sep-Oct', fertilizer: 'NPK 60:30:30 kg/ha', emoji: '🌿', varieties: ['ICTP-8203', 'Pusa-23'], msp: '₹2,500/qtl', intercrops: ['Greengram'], image: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=400&q=80', phRange: '6.5-7.5', rainfall: '300-500 mm' },
  { name: 'Finger Millet (Ragi)', season: 'Kharif', soils: ['Red', 'Laterite', 'Sandy'], water: 'Low', period: '100-130 days', yield: '15-25 q/ha', districts: ['Chittoor', 'Anantapur', 'Tirupati', 'Annamayya', 'Alluri Sitharama Raju'], sowing: 'June-July', harvest: 'Oct-Nov', fertilizer: 'NPK 50:40:25 kg/ha', emoji: '🌾', varieties: ['GPU-28', 'ML-365'], msp: '₹3,846/qtl', intercrops: ['Horsegram', 'Minor millets'], image: 'https://images.unsplash.com/photo-1580910365203-91ea9115a319?w=400&q=80', phRange: '5.5-7.0', rainfall: '500-800 mm' },
  { name: 'Black Gram (Urad)', season: 'Kharif', soils: ['Red', 'Black Cotton', 'Alluvial'], water: 'Low', period: '70-90 days', yield: '8-10 q/ha', districts: ['Guntur', 'Prakasam', 'Kurnool', 'Anantapur', 'Krishna', 'Srikakulam', 'Vizianagaram'], sowing: 'June-July', harvest: 'Aug-Sep', fertilizer: 'NPK 20:40:20 kg/ha', emoji: '🫘', varieties: ['LBG-752', 'PU-31', 'T-9'], msp: '₹6,950/qtl', intercrops: ['Maize'], image: 'https://images.unsplash.com/photo-1585011664466-b7bbe92f34ef?w=400&q=80', phRange: '6.0-7.0', rainfall: '400-600 mm' },
  // ── Rabi crops ──
  { name: 'Bengal Gram (Chana)', season: 'Rabi', soils: ['Black Cotton', 'Red', 'Alluvial'], water: 'Low', period: '90-110 days', yield: '12-15 q/ha', districts: ['Kurnool', 'Prakasam', 'Anantapur', 'Kadapa', 'Guntur', 'Nandyal', 'Nellore'], sowing: 'Oct-Nov', harvest: 'Jan-Feb', fertilizer: 'NPK 20:50:20 kg/ha + Rhizobium', emoji: '🫘', varieties: ['JG-11', 'KAK-2', 'Vihar'], msp: '₹5,440/qtl', intercrops: ['Sorghum (rabi)'], image: 'https://images.unsplash.com/photo-1612257416648-ee7a6c533848?w=400&q=80', phRange: '6.0-7.5', rainfall: '200-350 mm (residual)' },
  { name: 'Sunflower', season: 'Rabi', soils: ['Black Cotton', 'Red', 'Alluvial'], water: 'Moderate', period: '90-100 days', yield: '15-18 q/ha', districts: ['Kurnool', 'Prakasam', 'Anantapur', 'Guntur', 'Kadapa', 'Nandyal', 'Nellore'], sowing: 'Oct-Nov', harvest: 'Jan-Feb', fertilizer: 'NPK 60:80:30 kg/ha', emoji: '🌻', varieties: ['MACS-1181', 'KBSH-1', 'MSFH-8'], msp: '₹5,650/qtl', intercrops: [], image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400&q=80', phRange: '6.5-8.0', rainfall: 'Irrigated / 300-400 mm' },
  { name: 'Safflower', season: 'Rabi', soils: ['Black Cotton', 'Red'], water: 'Low', period: '120-140 days', yield: '10-12 q/ha', districts: ['Kurnool', 'Anantapur', 'Kadapa', 'Prakasam', 'Nandyal'], sowing: 'Oct-Nov', harvest: 'Feb-Mar', fertilizer: 'NPK 40:30:20 kg/ha', emoji: '🌼', varieties: ['Nalgonda (local)', 'A-1'], msp: '₹5,800/qtl', intercrops: [], image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400&q=80', phRange: '6.0-8.0', rainfall: '200-300 mm (residual)' },
  { name: 'Tobacco', season: 'Rabi', soils: ['Black Cotton', 'Alluvial', 'Red'], water: 'Moderate', period: '120-150 days', yield: '15-20 q/ha', districts: ['Guntur', 'Prakasam', 'Krishna', 'East Godavari', 'Bapatla'], sowing: 'Oct-Nov', harvest: 'Feb-Mar', fertilizer: 'NPK 100:50:100 kg/ha', emoji: '🍃', varieties: ['FCV (Virginia)', 'Cheruku'], msp: '₹6,500/qtl (auction)', intercrops: [], image: 'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?w=400&q=80', phRange: '5.5-6.5', rainfall: '400-600 mm' },
  { name: 'Rabi Paddy', season: 'Rabi', soils: ['Alluvial', 'Clay', 'Black Cotton'], water: 'High', period: '120-140 days', yield: '45-55 q/ha', districts: ['East Godavari', 'West Godavari', 'Krishna', 'Guntur', 'Nellore', 'Kakinada', 'Konaseema', 'Eluru'], sowing: 'Nov-Dec', harvest: 'Mar-Apr', fertilizer: 'NPK 120:60:40 kg/ha', emoji: '🌾', varieties: ['BPT-5204', 'NLR-34449', 'Annada'], msp: '₹2,300/qtl', intercrops: [], image: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=400&q=80', phRange: '6.0-7.5', rainfall: 'Canal irrigated' },
  { name: 'Rabi Black Gram (Urad)', season: 'Rabi', soils: ['Red', 'Black Cotton', 'Alluvial'], water: 'Low', period: '70-90 days', yield: '8-10 q/ha', districts: ['Guntur', 'Prakasam', 'Kurnool', 'Anantapur', 'Krishna', 'Srikakulam'], sowing: 'Oct-Nov', harvest: 'Dec-Jan', fertilizer: 'NPK 20:40:20 kg/ha', emoji: '🫘', varieties: ['LBG-752', 'T-9'], msp: '₹6,950/qtl', intercrops: [], image: 'https://images.unsplash.com/photo-1585011664466-b7bbe92f34ef?w=400&q=80', phRange: '6.0-7.0', rainfall: '200-300 mm (residual)' },
  { name: 'Onion', season: 'Rabi', soils: ['Red', 'Alluvial', 'Black Cotton'], water: 'Moderate', period: '120-150 days', yield: '200-300 q/ha', districts: ['Kurnool', 'Kadapa', 'Anantapur', 'Prakasam', 'Chittoor', 'Nandyal'], sowing: 'Oct-Nov', harvest: 'Feb-Mar', fertilizer: 'NPK 100:50:50 kg/ha', emoji: '🧅', varieties: ['Bellary Red', 'N-53', 'Pusa Red'], msp: '₹1,500-3,000/qtl (market)', intercrops: [], image: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=400&q=80', phRange: '6.0-7.0', rainfall: '350-500 mm' },
  { name: 'Mustard', season: 'Rabi', soils: ['Red', 'Sandy', 'Alluvial'], water: 'Low', period: '90-110 days', yield: '8-12 q/ha', districts: ['Srikakulam', 'Vizianagaram', 'Prakasam', 'Kurnool'], sowing: 'Oct-Nov', harvest: 'Jan-Feb', fertilizer: 'NPK 60:30:20 kg/ha', emoji: '🌼', varieties: ['Pusa Bold', 'RH-30'], msp: '₹5,650/qtl', intercrops: ['Fodder sorghum'], image: 'https://images.unsplash.com/photo-1547235001-d703406d3f17?w=400&q=80', phRange: '6.0-7.0', rainfall: '250-400 mm' },
  // ── Zaid / Summer crops ──
  { name: 'Watermelon', season: 'Zaid', soils: ['Sandy', 'Red', 'Alluvial'], water: 'Moderate', period: '80-100 days', yield: '250-400 q/ha', districts: ['Anantapur', 'Kurnool', 'Kadapa', 'Prakasam', 'Chittoor', 'Vizianagaram'], sowing: 'Feb-Mar', harvest: 'May-June', fertilizer: 'NPK 100:60:60 kg/ha', emoji: '🍉', varieties: ['Sugar Baby', 'Arka Manik'], msp: '₹800-1,500/qtl (market)', intercrops: [], image: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=400&q=80', phRange: '6.0-7.0', rainfall: 'Irrigated' },
  { name: 'Muskmelon', season: 'Zaid', soils: ['Sandy', 'Red', 'Alluvial'], water: 'Moderate', period: '70-90 days', yield: '150-250 q/ha', districts: ['Anantapur', 'Kadapa', 'Kurnool', 'Chittoor'], sowing: 'Feb-Mar', harvest: 'May-June', fertilizer: 'NPK 80:40:40 kg/ha', emoji: '🍈', varieties: ['Hara Madhu', 'Punjab Sunehri'], msp: '₹1,000-2,000/qtl (market)', intercrops: [], image: 'https://images.unsplash.com/photo-1571575173700-afb9492e6a50?w=400&q=80', phRange: '6.0-7.0', rainfall: 'Irrigated' },
  { name: 'Sesame (Til)', season: 'Zaid', soils: ['Red', 'Sandy', 'Laterite'], water: 'Low', period: '80-95 days', yield: '5-7 q/ha', districts: ['Anantapur', 'Kurnool', 'Prakasam', 'Kadapa', 'Chittoor'], sowing: 'Feb-Mar', harvest: 'May-June', fertilizer: 'NPK 30:15:15 kg/ha', emoji: '🌱', varieties: ['GT-10', 'VRI-1'], msp: '₹8,635/qtl', intercrops: [], image: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=400&q=80', phRange: '5.5-7.0', rainfall: '300-400 mm' },
  { name: 'Cucumber', season: 'Zaid', soils: ['Sandy', 'Alluvial', 'Red'], water: 'Moderate', period: '60-70 days', yield: '100-150 q/ha', districts: ['Chittoor', 'Anantapur', 'Kurnool', 'East Godavari', 'West Godavari'], sowing: 'Feb-Mar', harvest: 'Apr-May', fertilizer: 'NPK 60:40:40 kg/ha', emoji: '🥒', varieties: ['Pusa Uday', 'Hybrid varieties'], msp: '₹500-1,000/qtl (market)', intercrops: [], image: 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=400&q=80', phRange: '6.0-7.0', rainfall: 'Irrigated' },
  // ── Horticulture (all seasons) ──
  { name: 'Mango', season: 'Kharif', soils: ['Red', 'Laterite', 'Alluvial', 'Sandy'], water: 'Low', period: 'Perennial (fruits May-Jul)', yield: '100-200 q/ha', districts: ['Chittoor', 'Krishna', 'East Godavari', 'Srikakulam', 'Vizianagaram', 'Kadapa', 'Tirupati', 'Annamayya', 'Nellore'], sowing: 'Planting: Jun-Aug', harvest: 'May-July', fertilizer: 'NPK per tree: 1kg N, 0.5kg P, 1kg K', emoji: '🥭', varieties: ['Banginapalli', 'Totapuri', 'Dasheri', 'Alphonso'], msp: '₹3,000-8,000/qtl (market)', intercrops: ['Cashew (undergrowth)'], image: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=400&q=80', phRange: '5.5-7.5', rainfall: 'Drip irrigated / 800-1000 mm' },
  { name: 'Banana', season: 'Kharif', soils: ['Alluvial', 'Clay', 'Red'], water: 'High', period: '300-365 days', yield: '400-600 q/ha', districts: ['East Godavari', 'West Godavari', 'Krishna', 'Kadapa', 'Chittoor', 'Kakinada', 'Konaseema', 'Annamayya'], sowing: 'Jun-Aug', harvest: 'Year-round', fertilizer: 'NPK 200:60:200 g/plant', emoji: '🍌', varieties: ['Grand Naine', 'Robusta', 'Karpuravalli'], msp: '₹500-1,500/qtl (market)', intercrops: [], image: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&q=80', phRange: '6.0-7.5', rainfall: 'Drip irrigated / 1000-1200 mm' },
  { name: 'Coconut', season: 'Kharif', soils: ['Sandy', 'Alluvial', 'Coastal Saline', 'Laterite'], water: 'Moderate', period: 'Perennial (bears 5+ yrs)', yield: '80-120 nuts/palm/year', districts: ['East Godavari', 'West Godavari', 'Srikakulam', 'Vizianagaram', 'Visakhapatnam', 'Nellore', 'Kakinada', 'Konaseema'], sowing: 'Jun-Sep', harvest: 'Year-round', fertilizer: 'NPK 500:320:1200 g/palm', emoji: '🥥', varieties: ['East Coast Tall', 'Godavari Ganga', 'Chowghat Dwarf'], msp: '₹2,500-3,500/qtl (copra)', intercrops: ['Banana', 'Vegetables'], image: '', phRange: '5.5-8.0', rainfall: '1000-1500 mm' },
  { name: 'Cashew', season: 'Kharif', soils: ['Laterite', 'Red', 'Sandy'], water: 'Low', period: 'Perennial (bears 3+ yrs)', yield: '10-15 q/ha (raw nuts)', districts: ['Srikakulam', 'Vizianagaram', 'Visakhapatnam', 'East Godavari', 'Nellore', 'Alluri Sitharama Raju', 'Parvathipuram Manyam'], sowing: 'Jun-Sep', harvest: 'Mar-May', fertilizer: 'NPK 500:125:125 g/tree', emoji: '🌰', varieties: ['BPP-1', 'BPP-8', 'Ullal-3'], msp: '₹10,000-15,000/qtl (market)', intercrops: ['Minor millets (undergrowth)'], image: 'https://images.unsplash.com/photo-1563292769-4e05b684851a?w=400&q=80', phRange: '5.0-6.5', rainfall: '800-1200 mm' },
];

const AP_DISTRICTS = [
  'Anantapur', 'Chittoor', 'East Godavari', 'Guntur', 'Kadapa', 'Krishna',
  'Kurnool', 'Nellore', 'Prakasam', 'Srikakulam', 'Visakhapatnam',
  'Vizianagaram', 'West Godavari', 'Bapatla', 'Eluru', 'Palnadu',
  'Kakinada', 'Konaseema', 'NTR', 'Tirupati', 'Annamayya', 'Sri Sathya Sai',
  'Nandyal', 'Parvathipuram Manyam', 'Alluri Sitharama Raju', 'Anakapalli',
];

const AP_SOILS = [
  { id: 'Red', label: 'Red Soil', emoji: '🟤', desc: 'Iron-rich, well-drained' },
  { id: 'Black Cotton', label: 'Black Cotton', emoji: '⬛', desc: 'Moisture retentive' },
  { id: 'Alluvial', label: 'Alluvial', emoji: '🟡', desc: 'River delta, fertile' },
  { id: 'Laterite', label: 'Laterite', emoji: '🧱', desc: 'Leached, acidic' },
  { id: 'Sandy', label: 'Sandy', emoji: '🏜️', desc: 'Light, low nutrients' },
  { id: 'Coastal Saline', label: 'Coastal Saline', emoji: '🌊', desc: 'Salt-affected coast' },
  { id: 'Clay', label: 'Clay', emoji: '🏔️', desc: 'Heavy, water-logging' },
];

// --------------- Weather code mapping ---------------
const WEATHER_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snowfall', 73: 'Moderate snowfall', 75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

// =============== ROUTES ===============

// --- Health ---
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'SmartAgriCare Backend', timestamp: new Date().toISOString() }));

// Debug endpoint to test external API calls
app.get('/api/debug/fetch', async (_req, res) => {
  try {
    const testUrl = 'https://api.open-meteo.com/v1/forecast?latitude=17.68&longitude=83.21&current=temperature_2m';
    const response = await fetch(testUrl, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    res.json({ success: true, temperature: data.current?.temperature_2m, platform: process.platform });
  } catch (err) {
    res.json({ success: false, error: err.message, cause: err.cause?.message, platform: process.platform });
  }
});

// --- Auth: Validate token (for frontend startup check) ---
app.get('/api/auth/validate', requireAuth, (req, res) => {
  res.json({ success: true, userId: req.userId });
});

// --- Auth: Register ---
const authRateLimit = rateLimit(60000, 30); // 30 requests per minute per IP

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const phone = (req.body.phone || '').trim();
    const location = (req.body.location || '').trim();
    if (!name || name.length < 2) return res.status(400).json({ success: false, error: 'Name must be at least 2 characters' });
    if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'Valid email required' });
    if (!password || password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ success: false, error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const user = await createUser(name, email, hash, phone, location);
    const token = await generateToken(user.id);

    res.status(201).json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone || '', location: user.location || '' }, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// --- Auth: Login ---
app.post('/api/auth/login', authRateLimit, async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
    if (!password) return res.status(400).json({ success: false, error: 'Password is required' });

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const token = await generateToken(user.id);
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone || '', location: user.location || '' }, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// --- Auth: Forgot Password ---
const forgotRateLimit = rateLimit(60000, 3); // 3 requests per minute per IP (stricter)

app.post('/api/auth/forgot-password', forgotRateLimit, async (req, res) => {
  const requestStart = Date.now();
  // Target response time: 800-1200ms regardless of whether user exists
  const targetMs = 800 + Math.random() * 400;
  const delayRemaining = () => {
    const elapsed = Date.now() - requestStart;
    return Math.max(0, targetMs - elapsed);
  };

  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const user = await findUserByEmail(email);
    if (!user) {
      // Don't reveal whether email exists — delay to match real send timing
      await new Promise(r => setTimeout(r, delayRemaining()));
      return res.json({ success: true, message: 'If the email is registered, a reset code has been sent.' });
    }

    // Generate 6-digit OTP
    const otp = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
    await createResetToken(email, otp, expiresAt);

    // Try to send email
    if (emailConfigured) {
      try {
        await sendOtpEmail(email, otp);
        if (!IS_PROD) console.log(`OTP email sent to ${email}`);
        await new Promise(r => setTimeout(r, delayRemaining()));
        res.json({ success: true, message: 'Reset code sent to your email. Check your inbox.' });
      } catch (emailErr) {
        console.error('Email send failed:', emailErr.message);
        await new Promise(r => setTimeout(r, delayRemaining()));
        res.status(500).json({ success: false, error: 'Failed to send email. Please try again.' });
      }
    } else {
      // No email configured — dev fallback: log to console
      if (!IS_PROD) console.log(`[DEV] OTP for ${email}: ${otp} (expires: ${expiresAt})`);
      await new Promise(r => setTimeout(r, delayRemaining()));
      res.json({ success: true, message: 'Reset code sent to your email.' });
    }
  } catch (err) {
    console.error('Forgot password error:', err);
    await new Promise(r => setTimeout(r, delayRemaining()));
    res.status(500).json({ success: false, error: 'Failed to generate reset code' });
  }
});

// --- Auth: Reset Password ---
const resetRateLimit = rateLimit(60000, 5); // 5 reset attempts per minute per IP
app.post('/api/auth/reset-password', resetRateLimit, async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const otp = (req.body.otp || '').trim();
    const newPassword = req.body.newPassword || '';
    if (!email || !otp || !newPassword) return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const tokenId = await findValidResetToken(email, otp);
    if (!tokenId) return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });

    const hash = await bcrypt.hash(newPassword, 10);
    await updateUserPassword(email, hash);
    await markTokenUsed(tokenId);
    // Invalidate all existing auth tokens for this user (force re-login)
    await deleteAuthTokensByEmail(email);

    res.json({ success: true, message: 'Password reset successful. You can now login.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// --- Profile Update ---
app.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.userId; // From auth middleware, not from body
    const { name, phone, location } = req.body;
    const updated = await updateUserProfile(userId, {
      name: name?.trim(),
      phone: phone?.trim(),
      location: location?.trim(),
    });
    if (!updated) return res.status(400).json({ success: false, error: 'No fields to update' });
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// --- Auth: Logout ---
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization.slice(7);
  await deleteAuthToken(token);
  res.json({ success: true, message: 'Logged out' });
});

// --- Disease Reports ---
app.post('/api/disease/report', requireAuth, async (req, res) => {
  try {
    const { disease, confidence, cause, treatment, stores, imageName, crop, cropImage, status, severityLevel, symptoms, possibleCauses, preventiveMeasures, recommendation } = req.body;
    if (!disease) return res.status(400).json({ success: false, error: 'Disease name is required' });
    const id = await saveDiseaseReport(req.userId, { disease, confidence, cause, treatment, stores, imageName, crop, cropImage, status, severityLevel, symptoms, possibleCauses, preventiveMeasures, recommendation });
    res.status(201).json({ success: true, reportId: id });
  } catch (err) {
    console.error('Save report error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/soil/inquiry', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    const district = typeof body.district === 'string' ? body.district.trim() : '';
    const landAcresInput = body.landAcres === undefined || body.landAcres === null
      ? ''
      : String(body.landAcres).trim();
    const crop = typeof body.crop === 'string' ? body.crop.trim() : '';
    const soilType = typeof body.soilType === 'string' ? body.soilType.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ success: false, error: 'Name must be between 2 and 120 characters.' });
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (!/^[0-9+().\-\s]{7,25}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      return res.status(400).json({ success: false, error: 'Enter a valid phone number.' });
    }
    if (!district || district.length > 120) {
      return res.status(400).json({ success: false, error: 'District is required and must be at most 120 characters.' });
    }
    if (village.length > 120 || crop.length > 120 || soilType.length > 120 || notes.length > 2000) {
      return res.status(400).json({ success: false, error: 'One or more fields exceed the allowed length.' });
    }

    let landAcres = null;
    if (landAcresInput) {
      landAcres = Number(landAcresInput);
      if (!Number.isFinite(landAcres) || landAcres <= 0 || landAcres > 1000000) {
        return res.status(400).json({ success: false, error: 'Land size must be a positive number of acres.' });
      }
    }

    const inquiryId = await saveSoilInquiry(req.userId, {
      name, phone, village, district, landAcres, crop, soilType, notes,
    });
    flushSave();
    res.status(201).json({ success: true, inquiryId });
  } catch (err) {
    console.error('Save soil inquiry error:', err);
    res.status(500).json({ success: false, error: 'Failed to save soil inquiry.' });
  }
});

app.get('/api/soil/inquiries', requireAuth, async (req, res) => {
  try {
    const inquiries = await getUserSoilInquiries(req.userId);
    res.json({ success: true, inquiries });
  } catch (err) {
    console.error('Get soil inquiries error:', err);
    res.status(500).json({ success: false, error: 'Failed to load soil inquiries.' });
  }
});

app.get('/api/disease/reports', requireAuth, async (req, res) => {
  try {
    const reports = await getUserReports(req.userId);
    res.json({ success: true, reports });
  } catch (err) {
    console.error('Get reports error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

const collectiveRateLimit = rateLimit(60000, 8);
app.post('/api/disease/collective', [requireAuth, collectiveRateLimit], async (req, res) => {
  try {
    const {
      disease, crop, confidence, severity_level, status,
      symptoms, possible_causes, recommended_treatment, preventive_measures,
      rainfall, temperature, humidity, npk, soil_ph
    } = req.body;

    const cropName = crop || '';
    const diseaseName = disease || 'Unknown Condition';
    const sevLvl = (severity_level || 'Low').toString();

    const weather = {
      temperature: typeof temperature === 'number' ? temperature : null,
      humidity: typeof humidity === 'number' ? humidity : null,
      rainfall_7d_sum: typeof rainfall === 'number' ? rainfall : null,
    };
    const needsWeather = weather.temperature === null || weather.humidity === null || weather.rainfall_7d_sum === null;
    if (needsWeather) {
      const fetched = await fetchWeatherData(DEFAULT_WEATHER_LAT, DEFAULT_WEATHER_LON);
      if (weather.temperature === null) weather.temperature = fetched.temperature;
      if (weather.humidity === null) weather.humidity = fetched.humidity;
      if (weather.rainfall_7d_sum === null) weather.rainfall_7d_sum = fetched.rainfall_7d_sum;
    }

    const soilN = npk && typeof npk.n === 'number' ? npk.n : 80;
    const soilP = npk && typeof npk.p === 'number' ? npk.p : 40;
    const soilK = npk && typeof npk.k === 'number' ? npk.k : 40;
    const ph = typeof soil_ph === 'number' ? soil_ph : 6.8;

    const entry = findDiseaseEntry(cropName, diseaseName);
    const treatmentPlan = Array.isArray(recommended_treatment) && recommended_treatment.length > 0
      ? recommended_treatment
      : (entry && Array.isArray(entry.treatment) ? entry.treatment : [
          `Apply appropriate fungicide/insecticide at first sign of ${diseaseName}`,
          'Remove and destroy affected plant parts',
          'Monitor field closely every 3-5 days',
        ]);

    const preventivePlan = Array.isArray(preventive_measures) && preventive_measures.length > 0
      ? preventive_measures
      : (entry && Array.isArray(entry.natural_organic_treatment) ? entry.natural_organic_treatment : [
          'Practice crop rotation with non-host crops for next season',
          'Ensure proper field drainage and avoid waterlogging',
          'Maintain adequate plant spacing for air circulation',
          'Use disease-free certified seeds for next planting',
        ]);

    const sevLower = sevLvl.toLowerCase();
    let riskLevel = 'low';
    if (sevLower.includes('high') || sevLower.includes('severe') || sevLower.includes('critical')) riskLevel = 'severe';
    else if (sevLower.includes('moderate') || sevLower.includes('medium')) riskLevel = 'moderate';
    else if (sevLower.includes('low') || sevLower.includes('mild')) riskLevel = 'low';
    else riskLevel = 'high';

    const isHealthy = status === 'Healthy' || (diseaseName || '').toLowerCase().includes('healthy');
    if (isHealthy) riskLevel = 'low';

    const humPct = weather.humidity;
    const rain7d = weather.rainfall_7d_sum;
    const temp = weather.temperature;
    let weatherExacerbates = false;
    if (humPct >= 80) weatherExacerbates = true;
    if (rain7d >= 20) weatherExacerbates = true;
    if (riskLevel === 'low' && weatherExacerbates) riskLevel = 'moderate';
    else if (riskLevel === 'moderate' && weatherExacerbates) riskLevel = 'high';
    else if (riskLevel === 'high' && weatherExacerbates) riskLevel = 'severe';

    let riskExplanation = '';
    const confTxt = confidence ? ` (${confidence}% detection confidence)` : '';
    if (isHealthy) {
      riskExplanation = `Crop appears Healthy${confTxt}. Continue routine field monitoring and maintain good agronomic practices. Current conditions (${temp}°C, ${humPct}% humidity, ${rain7d}mm 7-day rain) are within normal range.`;
    } else {
      if (riskLevel === 'severe') {
        riskExplanation = `Severe risk — ${diseaseName}${confTxt} at ${sevLvl} severity combined with ${humPct}% humidity and ${rain7d}mm weekly rainfall creates ideal conditions for rapid disease spread. Immediate intervention is required to prevent significant yield loss.`;
      } else if (riskLevel === 'high') {
        riskExplanation = `High risk — ${diseaseName}${confTxt} at ${sevLvl} severity. Weather conditions (${temp}°C, ${humPct}% humidity, ${rain7d}mm rain) may accelerate spread. Begin treatment without delay and inspect neighboring plants.`;
      } else if (riskLevel === 'moderate') {
        riskExplanation = `Moderate risk — ${diseaseName}${confTxt} at ${sevLvl} severity. Monitor closely over the next 7 days and initiate treatment promptly if lesions expand or weather becomes more humid (current: ${humPct}% RH, ${rain7d}mm weekly rain).`;
      } else {
        riskExplanation = `Low risk — ${diseaseName}${confTxt} at ${sevLvl} severity. Current weather (${temp}°C, ${humPct}% RH, ${rain7d}mm weekly rain) is not strongly favourable to spread. Apply preventive measures and scout weekly.`;
      }
    }

    let fertilizerAdvice = '';
    let matchedCrop = null;
    const cropL = cropName.toLowerCase();
    for (const ac of AP_CROPS) {
      if (ac.name.toLowerCase().includes(cropL) || cropL.includes(ac.name.toLowerCase().split(' ')[0])) {
        matchedCrop = ac;
        break;
      }
    }
    for (const cp of CROP_PROFILES) {
      if (!matchedCrop && (cp.name.toLowerCase().includes(cropL) || cropL.includes(cp.id))) {
        matchedCrop = cp;
        break;
      }
    }
    const baseFert = matchedCrop && matchedCrop.fertilizer ? matchedCrop.fertilizer : 'Balanced NPK 120:60:60 kg/ha as per local agro-climatic zone';
    if (riskLevel === 'severe' || riskLevel === 'high') {
      fertilizerAdvice = `Disease stress: Reduce top-dress nitrogen by 20-25% to limit succulent growth that favours ${diseaseName}. Current soil N:${soilN} P:${soilP} K:${soilK}, pH ${ph}. Base fertilization for ${cropName || 'this crop'}: ${baseFert}. Increase potash (K) by 15-20 kg/ha to strengthen cell walls and boost disease resistance; consider foliar spray of 1% KNO₃ + micronutrients at flowering.`;
    } else if (riskLevel === 'moderate') {
      fertilizerAdvice = `Moderate disease pressure — Maintain balanced NPK nutrition (soil N:${soilN} P:${soilP} K:${soilK}, pH ${ph}). ${baseFert}. Supplement with additional potassium (+10 kg/ha K₂O) and foliar micronutrient spray to support plant immunity against ${diseaseName}.`;
    } else {
      fertilizerAdvice = `Low disease pressure — Continue standard balanced fertilization for ${cropName || 'this crop'}: ${baseFert}. Current soil status N:${soilN} P:${soilP} K:${soilK}, pH ${ph}. Ensure adequate but not excessive nitrogen to prevent lodging and maintain strong natural defences.`;
    }
    if (entry && Array.isArray(entry.deficiencies) && entry.deficiencies.length > 0) {
      fertilizerAdvice += ` Key nutrient watch: ${entry.deficiencies.slice(0, 2).join('; ')}. Correct any identified soil deficiencies before next crop cycle.`;
    }

    let weatherAdvice = '';
    if (humPct >= 85) {
      weatherAdvice = `Very high humidity (${humPct}%) strongly favours ${diseaseName || 'fungal disease'} development — avoid overhead watering, apply protective fungicide before wet periods, and ensure good canopy air flow.`;
    } else if (humPct >= 75) {
      weatherAdvice = `Elevated humidity (${humPct}%) may encourage ${diseaseName || 'disease'} spread — avoid evening irrigation, keep lower canopy dry, and monitor dew formation hours.`;
    } else if (humPct < 55) {
      weatherAdvice = `Low humidity (${humPct}%) is generally unfavourable for most fungal diseases of ${cropName || 'this crop'}; focus on adequate irrigation and pest monitoring instead.`;
    } else {
      weatherAdvice = `Moderate humidity (${humPct}%). Maintain good field drainage; no special weather-driven disease precautions beyond routine scouting.`;
    }
    if (rain7d >= 30) weatherAdvice += ` Recent heavy rainfall (${rain7d}mm in 7 days) has likely splashed spores — inspect lower leaves and apply contact fungicide if lesions appear.`;
    else if (rain7d >= 10) weatherAdvice += ` Recent rainfall (${rain7d}mm in 7 days) may have increased leaf wetness; scout 2-3 days after rain events.`;
    if (temp >= 32) weatherAdvice += ` Current high temperature (${temp}°C) accelerates pathogen reproduction cycles — shorten monitoring intervals.`;

    const farmTips = [
      `Practice crop rotation for next season — avoid planting ${cropName || 'the same crop'} consecutively; rotate with a non-host crop such as pulses or millets.`,
      'Maintain proper plant spacing and row orientation to maximise air movement and sunlight penetration through the canopy.',
      'Remove and safely destroy (burn/compost hot) all infected crop debris and stubble after harvest to break the disease cycle.',
      'Use disease-tolerant or resistant varieties in the next planting season — consult local KVK or agricultural department for region-specific recommendations.',
      'Scout your field early in the morning every 5-7 days; initial detection and treatment at 1-5% incidence gives best control results.',
      'If spraying fungicides, alternate chemical groups every 2 applications to delay development of fungicide resistance in pathogen populations.',
    ];
    const numTips = 3 + Math.floor(Math.random() * 2);
    const chosenTips = [farmTips[0], farmTips[1], farmTips[2]];
    if (numTips >= 4) chosenTips.push(farmTips[3 + Math.floor(Math.random() * 3)]);

    const smartRecommendation = {
      risk_assessment: riskExplanation,
      risk_level: riskLevel,
      treatment_plan: treatmentPlan,
      preventive_plan: preventivePlan,
      fertilizer_advice: fertilizerAdvice,
      weather_advice: weatherAdvice,
      farm_tips: chosenTips,
    };

    res.json({ success: true, smart_recommendation: smartRecommendation });
  } catch (err) {
    console.error('Collective AI coordinator error:', err);
    res.status(500).json({ success: false, error: 'Collective recommendation service temporarily unavailable' });
  }
});

// --- Disease Detection ---
// POST /predict and /api/disease/detect — proxy to ML service
const _rawMlUrl = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const ML_SERVICE_URL = _rawMlUrl.startsWith('http') ? _rawMlUrl : `http://${_rawMlUrl}`;
const { request: undiciRequest } = require('undici');

/** Query ML service /health and return a farmer-friendly status object. */
async function getMlServiceStatus() {
  try {
    const { statusCode, body } = await undiciRequest(`${ML_SERVICE_URL}/health`, {
      method: 'GET',
      headersTimeout: 5000,
      bodyTimeout: 5000,
    });
    if (statusCode !== 200) {
      return {
        available: false,
        modelReady: false,
        status: 'offline',
        reason: `ML service returned status ${statusCode}`,
        message: 'Disease detection engine is restarting. Please wait 30 seconds and try again.',
        model: null,
        modelError: '',
      };
    }
    const data = await body.json();
    const modelReady = !!data.model_ready;
    const status = modelReady ? 'ready' : 'degraded';
    let message = 'Disease detection engine ready. You can scan crop leaves.';
    let reason = '';
    if (!modelReady) {
      reason = data.model_error || 'Model weights not loaded';
      if (reason.toLowerCase().includes('model file') || reason.toLowerCase().includes('model_url')) {
        message = 'Disease detection model is being set up. Add best_model.h5 and class_indices_reverse.json to the models/ folder or configure MODEL_URL.';
      } else if (reason.toLowerCase().includes('failed to load model')) {
        message = 'Disease detection model failed to start. Ask your admin to check the model file and dependencies.';
      } else {
        message = 'Disease detection engine is warming up. Please try again in a moment.';
      }
    }
    return {
      available: true,
      modelReady,
      status,
      reason,
      message,
      model: data.model || null,
      classes: data.classes || 0,
      valAcc: data.val_acc || null,
      modelError: data.model_error || '',
    };
  } catch (err) {
    return {
      available: false,
      modelReady: false,
      status: 'offline',
      reason: err?.cause?.message || err.message || 'Connection refused',
      message: 'Disease detection engine is currently offline. Please start the ML service on port 5001.',
      model: null,
      modelError: '',
    };
  }
}

app.get('/api/ml-status', async (_req, res) => {
  const st = await getMlServiceStatus();
  res.json({ success: true, ...st });
});

const LANG_NAMES = { hi: 'Hindi', te: 'Telugu' };

/** Translate disease detection result using LLM cascade: Groq -> Gemini -> SambaNova. Returns translated data or original on failure. */
async function translateDiseaseResult(data, lang) {
  if (!LANG_NAMES[lang]) return data;
  if (!GROQ_API_KEY && !GEMINI_API_KEY && !SAMBANOVA_API_KEY) return data;

  const langName = LANG_NAMES[lang];
  const toTranslate = {
    disease: data.disease || '',
    crop: data.crop || '',
    cause: data.cause || data.cause_of_disease || '',
    treatment: data.treatment || [],
    medication_timeline: (data.medication_timeline || []).map(m => ({
      medicine: m.medicine,
      when_to_apply: m.when_to_apply,
      repeat: m.repeat,
      total_duration: m.total_duration,
    })),
    viral_note: data.viral_note || '',
    message: data.message || '',
    max_sprays: data.max_sprays || '',
    symptoms: data.symptoms || [],
    preventive_measures: data.preventive_measures || data.preventiveMeasures || [],
    severity_level: data.severity_level || data.severityLevel || '',
    possible_causes: data.possible_causes || data.possibleCauses || '',
  };
  if (data.smart_recommendation && typeof data.smart_recommendation === 'object') {
    toTranslate.smart_recommendation = {
      risk_assessment: data.smart_recommendation.risk_assessment || '',
      treatment_plan: data.smart_recommendation.treatment_plan || [],
      preventive_plan: data.smart_recommendation.preventive_plan || [],
      fertilizer_advice: data.smart_recommendation.fertilizer_advice || '',
      weather_advice: data.smart_recommendation.weather_advice || '',
      farm_tips: data.smart_recommendation.farm_tips || [],
    };
  }

  const prompt = `Translate the following crop disease detection result to ${langName}. Keep medicine names, chemical names, quantities, and numbers in English. Return ONLY valid JSON with the same keys. Do not add any explanation.\n\n${JSON.stringify(toTranslate)}`;

  let translatedText = '';

  // ── Try Groq first (primary) ──
  if (GROQ_API_KEY) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const result = await response.json();
        translatedText = result.choices?.[0]?.message?.content || '';
        if (translatedText) console.log('Translation via Groq');
      } else {
        throw new Error(`Groq ${response.status}`);
      }
    } catch (e) {
      console.log('Groq translation failed:', e.message);
    }
  }

  // ── Fallback 1: Gemini ──
  if (!translatedText && GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const result = await response.json();
        translatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (translatedText) console.log('Translation via Gemini');
      } else {
        throw new Error(`Gemini ${response.status}`);
      }
    } catch (e) {
      console.log('Gemini translation failed:', e.message);
    }
  }

  // ── Fallback 2: SambaNova ──
  if (!translatedText && SAMBANOVA_API_KEY) {
    try {
      const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SAMBANOVA_API_KEY}`,
        },
        body: JSON.stringify({
          model: SAMBANOVA_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const result = await response.json();
        translatedText = result.choices?.[0]?.message?.content || '';
        if (translatedText) console.log('Translation via SambaNova');
      } else {
        throw new Error(`SambaNova ${response.status}`);
      }
    } catch (e) {
      console.log('SambaNova translation failed:', e.message);
    }
  }

  if (!translatedText) return data;

  try {
    // Strip markdown code fences if present
    translatedText = translatedText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const translated = JSON.parse(translatedText);
    // Merge translated fields back into original data
    const merged = {
      ...data,
      disease: translated.disease || data.disease,
      crop: translated.crop || data.crop,
      cause: translated.cause || data.cause,
      cause_of_disease: translated.cause || data.cause_of_disease,
      treatment: translated.treatment || data.treatment,
      medication_timeline: (data.medication_timeline || []).map((m, i) => ({
        ...m,
        when_to_apply: translated.medication_timeline?.[i]?.when_to_apply || m.when_to_apply,
        repeat: translated.medication_timeline?.[i]?.repeat || m.repeat,
        total_duration: translated.medication_timeline?.[i]?.total_duration || m.total_duration,
      })),
      viral_note: translated.viral_note || data.viral_note,
      message: translated.message || data.message,
      max_sprays: translated.max_sprays || data.max_sprays,
      symptoms: translated.symptoms || data.symptoms,
      preventive_measures: translated.preventive_measures || data.preventive_measures,
      preventiveMeasures: translated.preventive_measures || data.preventiveMeasures,
      severity_level: translated.severity_level || data.severity_level,
      severityLevel: translated.severity_level || data.severityLevel,
      possible_causes: translated.possible_causes || data.possible_causes,
      possibleCauses: translated.possible_causes || data.possibleCauses,
    };
    if (translated.smart_recommendation && data.smart_recommendation) {
      merged.smart_recommendation = {
        ...data.smart_recommendation,
        risk_assessment: translated.smart_recommendation.risk_assessment || data.smart_recommendation.risk_assessment,
        treatment_plan: translated.smart_recommendation.treatment_plan || data.smart_recommendation.treatment_plan,
        preventive_plan: translated.smart_recommendation.preventive_plan || data.smart_recommendation.preventive_plan,
        fertilizer_advice: translated.smart_recommendation.fertilizer_advice || data.smart_recommendation.fertilizer_advice,
        weather_advice: translated.smart_recommendation.weather_advice || data.smart_recommendation.weather_advice,
        farm_tips: translated.smart_recommendation.farm_tips || data.smart_recommendation.farm_tips,
      };
    }
    return merged;
  } catch (e) {
    console.log('Translation JSON parse failed:', e.message);
    return data;
  }
}

async function proxyToMlService(req, res) {
  const requestedLang = req.headers['x-language'] || '';

  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > 15 * 1024 * 1024) {
    return res.status(413).json({ success: false, error: 'Image too large. Max 15 MB.' });
  }

  let mlResp = null;
  try {
    mlResp = await require('undici').request(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] },
      body: req,
      headersTimeout: 60000,
      bodyTimeout: 60000,
    });
    const data = await mlResp.body.json();
    if (mlResp.statusCode >= 400) {
      const rawMsg = data.error || `ML ${mlResp.statusCode}`;
      // Translate ML-returned error to a farmer-friendly message
      const lower = String(rawMsg).toLowerCase();
      let friendly = 'Disease detection engine had an issue. Please try again with a clearer close-up leaf photo.';
      if (lower.includes('model file') || lower.includes('model_url') || lower.includes('model is not available')) {
        friendly = 'Disease detection model is being set up on the ML service. Please try again in a moment.';
      } else if (lower.includes('invalid image')) {
        friendly = 'That file could not be read as an image. Please try a different photo (JPG or PNG).';
      } else if (lower.includes('too large') || lower.includes('dimensions')) {
        friendly = 'That photo is too large. Take a smaller close-up picture and try again.';
      } else if (lower.includes('service busy') || lower.includes('overloaded')) {
        friendly = 'Disease detection is busy right now. Please try again in 30 seconds.';
      } else if (lower.includes('no image file')) {
        friendly = 'No photo was sent. Please take or upload a clear leaf picture first.';
      }
      return res.status(mlResp.statusCode === 413 ? 413 : mlResp.statusCode === 400 ? 400 : 503).json({
        success: false,
        status: 'error',
        error: friendly,
        rawError: rawMsg,
        details: data.details || null,
      });
    }
    if (requestedLang && requestedLang !== 'en') {
      const translated = await translateDiseaseResult(data, requestedLang);
      return res.json(translated);
    }
    return res.json(data);
  } catch (err) {
    console.error('ML service unavailable:', err.message, err.cause?.message || '');
    // Check live ML status for a more precise message
    let friendly = 'Disease detection service is currently unavailable. Please try again in a moment.';
    try {
      const st = await getMlServiceStatus();
      if (st.status === 'offline') friendly = 'Disease detection engine is currently offline. Ask your admin to start the ML service on port 5001.';
      else if (!st.modelReady) friendly = st.message || friendly;
    } catch {}
    res.status(503).json({
      success: false,
      status: 'error',
      error: friendly,
      _debug: err.message,
      _cause: err.cause?.message,
    });
  }
}

function findDiseaseEntry(cropName, diseaseName) {
  if (!cropName || !diseaseName) return null;
  const cropL = cropName.toLowerCase();
  const diseaseL = diseaseName.toLowerCase();
  let cropKey = null;
  if (cropL.includes('corn') || cropL.includes('maize') || cropL.includes('మొక్కజొన్న') || cropL.includes('मक्का')) cropKey = 'corn_maize';
  else if (cropL.includes('cotton') || cropL.includes('ప్రత్తి') || cropL.includes('कपास')) cropKey = 'cotton';
  else if (cropL.includes('paddy') || cropL.includes('rice') || cropL.includes('వరి') || cropL.includes('धान')) cropKey = 'paddy';
  else if (cropL.includes('sugarcane') || cropL.includes('చెరకు') || cropL.includes('गन्ना')) cropKey = 'sugarcane';
  if (!cropKey || !CROP_DISEASE_DATA[cropKey]) return null;
  const cropData = CROP_DISEASE_DATA[cropKey];
  for (const [key, val] of Object.entries(cropData)) {
    if (typeof val === 'object' && val.disease && val.disease.toLowerCase().includes(diseaseL)) return val;
    if (key === 'healthy' && (diseaseL.includes('healthy') || diseaseL.includes('health'))) return val;
    const dKeyL = key.toLowerCase().replace(/_/g, ' ');
    if (dKeyL && (diseaseL.includes(dKeyL) || dKeyL.includes(diseaseL))) return val;
  }
  return null;
}

function enrichMlResponse(mlData) {
  if (!mlData) return mlData;
  const isSuccess = mlData.success !== false && !mlData.low_confidence;
  const crop = mlData.crop || '';
  const disease = mlData.disease || '';
  const confidencePct = typeof mlData.confidence === 'number'
    ? Math.round(mlData.confidence * 100)
    : (typeof mlData.confidence === 'string' && !isNaN(parseFloat(mlData.confidence))
      ? Math.round(parseFloat(mlData.confidence) * 100)
      : null);
  let status = (mlData.status === 'healthy' || (disease || '').toLowerCase().includes('healthy')) ? 'healthy' : 'diseased';
  if (!isSuccess || mlData.low_confidence) status = mlData.low_confidence ? 'unknown' : status;
  if (mlData.status === 'unrecognized') status = 'unrecognized';
  const entry = findDiseaseEntry(crop, disease);
  const rawSeverity = mlData.severity_level || mlData.severity || '';
  let severityLevel = rawSeverity;
  if (!severityLevel && entry) {
    const conf = confidencePct || 70;
    if (conf >= 90) severityLevel = 'High';
    else if (conf >= 75) severityLevel = 'Moderate';
    else severityLevel = 'Low';
  }
  const symptoms = Array.isArray(mlData.symptoms) && mlData.symptoms.length > 0
    ? mlData.symptoms
    : (entry && entry.symptoms ? entry.symptoms : (entry && entry.cause_of_disease ? [entry.cause_of_disease.split('.')[0]] : []));
  const possibleCauses = mlData.possible_causes || mlData.possibleCauses || mlData.cause || mlData.cause_of_disease || (entry ? entry.cause_of_disease : '') || '';
  const recommendedTreatment = Array.isArray(mlData.treatment) && mlData.treatment.length > 0
    ? mlData.treatment
    : (entry && Array.isArray(entry.treatment) ? entry.treatment : []);
  const preventiveMeasures = Array.isArray(mlData.preventive_measures) && mlData.preventive_measures.length > 0
    ? mlData.preventive_measures
    : (entry && Array.isArray(entry.natural_organic_treatment) ? entry.natural_organic_treatment : []);
  const quality = mlData.quality || mlData.image_quality || (confidencePct !== null ? (confidencePct >= 85 ? 'good' : confidencePct >= 60 ? 'acceptable' : 'poor') : 'unknown');
  const isPlant = mlData.is_plant !== undefined ? mlData.is_plant : !mlData.low_confidence;
  return {
    ...mlData,
    success: isSuccess,
    disease,
    crop,
    confidence: confidencePct,
    status,
    severity_level: severityLevel,
    severityLevel,
    symptoms,
    possible_causes: possibleCauses,
    possibleCauses,
    recommended_treatment: recommendedTreatment,
    preventive_measures: preventiveMeasures,
    preventiveMeasures,
    quality,
    is_plant: isPlant,
  };
}

async function detectAndEnrichHandler(req, res) {
  const requestedLang = req.headers['x-language'] || '';
  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > 15 * 1024 * 1024) {
    return res.status(413).json({ success: false, error: 'Image too large. Max 15 MB.' });
  }
  let mlResp = null;
  try {
    mlResp = await require('undici').request(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] },
      body: req,
      headersTimeout: 60000,
      bodyTimeout: 60000,
    });
    const data = await mlResp.body.json();
    if (mlResp.statusCode >= 400) {
      const rawMsg = data.error || `ML ${mlResp.statusCode}`;
      const lower = String(rawMsg).toLowerCase();
      let friendly = 'Disease detection engine had an issue. Please try again with a clearer close-up leaf photo.';
      if (lower.includes('model file') || lower.includes('model_url') || lower.includes('model is not available')) {
        friendly = 'Disease detection model is being set up on the ML service. Please try again in a moment.';
      } else if (lower.includes('invalid image')) {
        friendly = 'That file could not be read as an image. Please try a different photo (JPG or PNG).';
      } else if (lower.includes('too large') || lower.includes('dimensions')) {
        friendly = 'That photo is too large. Take a smaller close-up picture and try again.';
      } else if (lower.includes('service busy') || lower.includes('overloaded')) {
        friendly = 'Disease detection is busy right now. Please try again in 30 seconds.';
      } else if (lower.includes('no image file')) {
        friendly = 'No photo was sent. Please take or upload a clear leaf picture first.';
      }
      return res.status(mlResp.statusCode === 413 ? 413 : mlResp.statusCode === 400 ? 400 : 503).json({
        success: false, status: 'error', error: friendly,
        rawError: rawMsg, details: data.details || null,
      });
    }
    const enriched = enrichMlResponse(data);
    if (requestedLang && requestedLang !== 'en') {
      const translated = await translateDiseaseResult(enriched, requestedLang);
      return res.json(translated);
    }
    return res.json(enriched);
  } catch (err) {
    console.error('ML service unavailable:', err.message, err.cause?.message || '');
    let friendly = 'Disease detection service is currently unavailable. Please try again in a moment.';
    try {
      const st = await getMlServiceStatus();
      if (st.status === 'offline') friendly = 'Disease detection engine is currently offline. Ask your admin to start the ML service on port 5001.';
      else if (!st.modelReady) friendly = st.message || friendly;
    } catch {}
    res.status(503).json({
      success: false, status: 'error', error: friendly,
      _debug: err.message, _cause: err.cause?.message,
    });
  }
}

async function fetchWeatherData(lat = DEFAULT_WEATHER_LAT, lng = DEFAULT_WEATHER_LON) {
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation&daily=precipitation_sum&timezone=auto&forecast_days=7`;
    const weatherRes = await fetchWithRetry(weatherUrl, {}, 2, 1500, 15000);
    const wd = await weatherRes.json();
    const current = wd.current || {};
    const daily = wd.daily || {};
    const rainfall7d = Array.isArray(daily.precipitation_sum)
      ? daily.precipitation_sum.reduce((a, b) => a + (Number(b) || 0), 0)
      : 0;
    return {
      temperature: Math.round(current.temperature_2m || 28),
      humidity: current.relative_humidity_2m || 65,
      rainfall_current: current.precipitation || 0,
      rainfall_7d_sum: Math.round(rainfall7d * 10) / 10,
    };
  } catch (err) {
    console.warn('Weather fetch failed for collective, using defaults:', err.message);
    return { temperature: 28, humidity: 65, rainfall_current: 0, rainfall_7d_sum: 10 };
  }
}

const detectRateLimit = rateLimit(60000, 10); // 10 disease detections per minute per IP
app.post('/predict', detectRateLimit, proxyToMlService);
app.post('/api/disease/detect', detectRateLimit, detectAndEnrichHandler);

app.get('/api/diseases', (_req, res) => {
  res.json({
    success: true,
    diseases: [
      { id: 1, name: 'Late Blight', crop: 'Tomato', severity: 'High' },
      { id: 2, name: 'Leaf Rust', crop: 'Wheat', severity: 'Medium' },
      { id: 3, name: 'Powdery Mildew', crop: 'Grape', severity: 'Low' },
    ],
  });
});

app.get('/api/diseases/:name', (req, res) => {
  const name = req.params.name.toLowerCase();
  const diseases = {
    'late blight': { name: 'Late Blight', crop: 'Tomato', severity: 'High', cause: 'Phytophthora infestans', treatment: ['Copper-based fungicide', 'Remove infected parts'] },
    'leaf rust': { name: 'Leaf Rust', crop: 'Wheat', severity: 'Medium', cause: 'Puccinia triticina', treatment: ['Fungicide application', 'Resistant varieties'] },
  };
  const disease = diseases[name];
  if (disease) return res.json({ success: true, disease });
  res.status(404).json({ success: false, error: 'Disease not found' });
});

// --- Crop Recommendation (AP) ---

// Lightweight metadata (soils + districts only, no crop computation)
app.get('/api/crop-meta', (_req, res) => {
  res.json({ success: true, soils: AP_SOILS, districts: AP_DISTRICTS });
});

app.post('/api/crops/recommend', async (req, res) => {
  try {
    const { season, soil, water, district, land } = req.body;
    if (!season) return res.status(400).json({ success: false, error: 'Season is required' });

    let crops = [...AP_CROPS];

    // Filter to only crops that have images in the crops folder
    crops = crops.filter(c => {
      const cropName = c.name.toLowerCase();
      return CROPS_WITH_IMAGES.some(imgCrop => cropName.includes(imgCrop.toLowerCase()) || imgCrop.toLowerCase().includes(cropName.split(' ')[0]));
    });

    // Filter by season
    const seasonKey = season.toLowerCase();
    crops = crops.filter(c => c.season.toLowerCase().includes(seasonKey.replace(/\s*\(.*\)/, '')));

    // Filter by soil (keep crops that list this soil)
    if (soil) {
      crops = crops.filter(c => c.soils.some(s => s.toLowerCase().includes(soil.toLowerCase())));
    }

    // Filter by water availability
    if (water) {
      const waterLower = water.toLowerCase();
      // Exact match + allow "High" to include "Moderate" crops (over-irrigation is ok)
      crops = crops.filter(c => {
        const cw = c.water.toLowerCase();
        if (cw === waterLower) return true;
        if (waterLower === 'high' && cw === 'moderate') return true;
        if (waterLower === 'moderate' && cw === 'low') return true;
        return false;
      });
    }

    // Filter by district
    if (district) {
      const distLower = district.toLowerCase();
      // Primary: exact district in crop's list. Fallback: keep all if no district match.
      const districtCrops = crops.filter(c => c.districts.some(d => d.toLowerCase().includes(distLower)));
      if (districtCrops.length > 0) crops = districtCrops;
    }

    // Calculate match score (research-based weighting)
    crops = crops.map(c => {
      let match = 60; // base
      // Soil match: primary soil (first) = +15, secondary = +10
      if (soil) {
        if (c.soils[0].toLowerCase() === soil.toLowerCase()) match += 15;
        else if (c.soils.some(s => s.toLowerCase() === soil.toLowerCase())) match += 10;
      }
      // District match: primary (first listed) = +12, secondary = +8
      if (district) {
        const distLower = (district || '').toLowerCase();
        if (c.districts[0]?.toLowerCase().includes(distLower)) match += 12;
        else if (c.districts.some(d => d.toLowerCase().includes(distLower))) match += 8;
      }
      // Water match: exact = +10, close = +5
      if (water) {
        if (c.water.toLowerCase() === water.toLowerCase()) match += 10;
        else match += 5;
      }
      // Land size bonus: small land (<3 ac) favors short-period / high-value crops
      const landAcres = parseFloat(land) || 2;
      const periodDays = parseInt(c.period) || 120;
      if (landAcres <= 3 && periodDays <= 100) match += 3;
      if (landAcres > 10 && periodDays >= 150) match += 3;

      return { ...c, match: Math.min(match, 98) };
    }).sort((a, b) => b.match - a.match);

    // If no matches, return all season crops as fallback
    if (crops.length === 0) {
      crops = AP_CROPS.filter(c => c.season.toLowerCase().includes(seasonKey.replace(/\s*\(.*\)/, ''))).map(c => ({ ...c, match: 65 }));
    }

    // Limit to top 12
    crops = crops.slice(0, 12);

    // Save to history if user is authenticated (optional auth)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const userId = await verifyToken(token);
      if (userId && crops.length > 0) {
        try {
          // Store a compact version of results for history
          const compactResults = crops.map(c => ({
            name: c.name, match: c.match, emoji: c.emoji, period: c.period,
            water: c.water, fertilizer: c.fertilizer, districts: c.districts,
          }));
          await saveCropRecommendation(userId, {
            season, soil: soil || '', water: water || '', district: district || '',
            land: land || '', topCrop: crops[0].name, topMatch: crops[0].match,
            results: compactResults,
          });
        } catch (saveErr) {
          console.error('Failed to save crop recommendation history:', saveErr.message);
        }
      }
    }

    res.json({ success: true, crops, soils: AP_SOILS, districts: AP_DISTRICTS });
  } catch (err) {
    console.error('Crop recommend error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// --- Crop recommendation history (authenticated) ---
app.get('/api/crop-recommendations/history', requireAuth, async (req, res) => {
  try {
    const history = await getUserCropRecommendations(req.userId);
    res.json({ success: true, history });
  } catch (err) {
    console.error('Get crop recommendation history error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Legacy GET endpoint
app.get('/api/crops/recommend', (req, res) => {
  const season = req.query.season || 'Kharif';
  const crops = AP_CROPS.filter(c => c.season.toLowerCase() === season.toLowerCase().replace(/\s*\(.*\)/, '')).slice(0, 6).map(c => ({ ...c, match: 85 }));
  res.json({ success: true, crops, soils: AP_SOILS, districts: AP_DISTRICTS });
});

app.get('/api/crops/:name', (req, res) => {
  const name = req.params.name.toLowerCase();
  const crop = AP_CROPS.find(c => c.name.toLowerCase().includes(name));
  if (crop) return res.json({ success: true, crop });
  res.status(404).json({ success: false, error: 'Crop not found' });
});

// ── Crop & Fertilizer Collective Intelligence Module ─────────────────
async function generateAgronomicInsight(prompt) {
  if (GROQ_API_KEY) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: 'You are the chief agronomy AI coordinator for AgroSmart.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.5,
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
      }
    } catch (e) {
      // LLM failure handled gracefully by deterministic agronomist engine
    }
  }
  return '';
}

app.post('/api/crop-fertilizer/analyze', async (req, res) => {
  try {
    const { n, p, k, ph, temperature, humidity, rainfall, language } = req.body;
    if (n === undefined || p === undefined || k === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Nitrogen (N), Phosphorus (P), and Potassium (K) are required.'
      });
    }

    const result = await coordinateCropAndFertilizer({
      n: parseFloat(n) || 0,
      p: parseFloat(p) || 0,
      k: parseFloat(k) || 0,
      ph: parseFloat(ph) || 6.5,
      temperature: parseFloat(temperature) || 28,
      humidity: parseFloat(humidity) || 65,
      rainfall: parseFloat(rainfall) || 750,
    }, language || 'en', generateAgronomicInsight);

    res.json(result);
  } catch (err) {
    console.error('Crop & Fertilizer Collective Intelligence error:', err);
    res.status(500).json({ success: false, error: 'Failed to process crop and fertilizer recommendation' });
  }
});

app.get('/api/crop-fertilizer/meta', (req, res) => {
  res.json({
    success: true,
    supportedCrops: CROP_PROFILES.map(c => ({
      id: c.id,
      name: c.name,
      teluguName: c.teluguName,
      hindiName: c.hindiName,
      emoji: c.emoji,
      category: c.category,
      season: c.season,
      optimalRanges: c.optimalRanges
    })),
    presets: [
      {
        id: 'coastal_delta',
        label: 'Coastal / Delta Alluvial Soil (Paddy Zone)',
        emoji: '🌾',
        data: { n: 110, p: 45, k: 50, ph: 6.8, temperature: 29, humidity: 80, rainfall: 1150 }
      },
      {
        id: 'black_cotton',
        label: 'Black Cotton Heavy Soil (Cotton / Chillies Zone)',
        emoji: '🏵️',
        data: { n: 95, p: 35, k: 65, ph: 7.6, temperature: 31, humidity: 55, rainfall: 650 }
      },
      {
        id: 'red_sandy_loam',
        label: 'Red Sandy Loam (Groundnut / Pulses Zone)',
        emoji: '🥜',
        data: { n: 25, p: 30, k: 35, ph: 6.4, temperature: 30, humidity: 50, rainfall: 550 }
      },
      {
        id: 'dryland_rabi',
        label: 'Dryland Rabi Basin (Bengal Gram / Sunflower)',
        emoji: '🫘',
        data: { n: 28, p: 40, k: 25, ph: 7.2, temperature: 22, humidity: 45, rainfall: 320 }
      }
    ]
  });
});


// --- Resilient fetch with retry ---
async function fetchWithRetry(url, options = {}, retries = 2, delayMs = 1000, timeoutMs = 15000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

// --- Weather (Open-Meteo + reverse geocoding) ---
const weatherRateLimit = rateLimit(60000, 20); // 20 weather requests per minute per IP
const _weatherCache = new Map(); // key: "lat,lng" (truncated) → { data, ts }
const WEATHER_CACHE_TTL = 300000; // 5 minutes - weather doesn't change that fast
const DEFAULT_WEATHER_LAT = 15.8497;
const DEFAULT_WEATHER_LON = 74.4977;
const _nominatimCache = new Map(); // key: "lat,lng" (truncated) → { name, ts }
const NOMINATIM_CACHE_TTL = 3600000; // 1 hour
// Evict stale Nominatim cache entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _nominatimCache) {
    if (now - val.ts > NOMINATIM_CACHE_TTL) _nominatimCache.delete(key);
  }
  for (const [key, val] of _weatherCache) {
    if (now - val.ts > WEATHER_CACHE_TTL) _weatherCache.delete(key);
  }
}, NOMINATIM_CACHE_TTL);
const PLACE_ALIASES = {
  belgaum: 'Belagavi',
  belgaavi: 'Belagavi',
  belgavi: 'Belagavi',
  'belgaum city': 'Belagavi',
};
const UNTRUSTED_WEATHER_PLACES = ['nelamangala', 'yelahanka', 'hoskote', 'devanahalli', 'whitefield'];

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizePlaceName(name) {
  if (!name) return '';
  const key = String(name).toLowerCase().replace(/,.*$/, '').trim();
  return PLACE_ALIASES[key] || name.replace(/,.*$/, '').trim();
}

function resolveWeatherLocationName(lat, lon, rawName, query) {
  if (query) return query;
  const nearest = Object.entries(KARNATAKA_DISTRICT_COORDS).reduce((best, [name, c]) => {
    const km = haversineKm(lat, lon, c.lat, c.lng);
    return km < best.km ? { name, km } : best;
  }, { name: 'Belagavi', km: Infinity });
  const normalized = normalizePlaceName(rawName);
  const low = normalized.toLowerCase();
  if (UNTRUSTED_WEATHER_PLACES.some((p) => low.includes(p))) {
    return 'Belagavi, IN';
  }
  if (nearest.km <= 40) return `${nearest.name}, IN`;
  return normalized ? `${normalized}, IN` : 'Belagavi, IN';
}

app.get('/api/weather', weatherRateLimit, async (req, res) => {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const rawLat = parseFloat(req.query.lat ?? req.query.latitude);
    const rawLon = parseFloat(req.query.lon ?? req.query.lng ?? req.query.longitude);
    const lat = isNaN(rawLat) ? DEFAULT_WEATHER_LAT : Math.max(-90, Math.min(90, rawLat));
    const lon = isNaN(rawLon) ? DEFAULT_WEATHER_LON : Math.max(-180, Math.min(180, rawLon));
    const cacheKey = q ? `q_${q.toLowerCase()}` : `${lat.toFixed(2)},${lon.toFixed(2)}`;

    // Check weather cache first
    const cachedWeather = _weatherCache.get(cacheKey);
    if (cachedWeather && Date.now() - cachedWeather.ts < WEATHER_CACHE_TTL) {
      return res.json(cachedWeather.data);
    }

    const apiKey = WEATHER_API_KEY && WEATHER_API_KEY !== 'YOUR_API_KEY' && WEATHER_API_KEY.trim().length === 32
      ? WEATHER_API_KEY.trim()
      : '';

    // 1. Try OpenWeatherMap API if API key is provided
    if (apiKey) {
      try {
        const owmUrl = q
          ? `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(q)}&appid=${apiKey}&units=metric`
          : `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;

        const owmRes = await fetch(owmUrl, { signal: AbortSignal.timeout(10000) });
        if (owmRes.status === 404 && q) {
          return res.status(404).json({ success: false, error: 'Location not found. Please try another city.' });
        }
        if (owmRes.ok) {
          const data = await owmRes.json();
          const rainfall = data.rain ? (data.rain['1h'] ?? data.rain['3h'] ?? 0) : 0;
          const condition = data.weather?.[0]?.main || 'Clear';
          const description = data.weather?.[0]?.description || 'clear sky';
          const iconCode = data.weather?.[0]?.icon || '01d';
          const iconUrl = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
          const locationName = resolveWeatherLocationName(
            data.coord?.lat ?? lat,
            data.coord?.lon ?? lon,
            `${data.name}${data.sys?.country ? ', ' + data.sys.country : ''}`,
            q
          );
          const nowIso = new Date().toISOString();

          // visibility from OWM is in metres, convert to km (max 10km)
          const visibilityKm = data.visibility !== undefined
            ? Number((Math.min(data.visibility, 10000) / 1000).toFixed(1))
            : null;

          const weatherObj = {
            location: locationName,
            temperature: Math.round(data.main?.temp ?? 27),
            feels_like: Math.round(data.main?.feels_like ?? data.main?.temp ?? 28),
            feelsLike: Math.round(data.main?.feels_like ?? data.main?.temp ?? 28),
            humidity: Math.round(data.main?.humidity ?? 70),
            rainfall: Number(rainfall.toFixed(1)),
            precipitation: Number(rainfall.toFixed(1)),
            wind_speed: Number((data.wind?.speed ?? 3.2).toFixed(1)),
            windSpeed: Number((data.wind?.speed ?? 3.2).toFixed(1)),
            wind_deg: data.wind?.deg ?? null,
            pressure: Math.round(data.main?.pressure ?? 1012),
            visibility: visibilityKm,
            weather_condition: condition,
            condition: condition,
            weather_description: description,
            description: description,
            weather_icon: iconUrl,
            icon: iconUrl,
            iconCode,
            last_updated: nowIso,
            lastUpdated: nowIso,
            lat: data.coord?.lat ?? lat,
            lon: data.coord?.lon ?? lon,
            source: 'OpenWeatherMap',
            forecast: [],
          };

          const responseData = { success: true, weather: weatherObj };
          _weatherCache.set(cacheKey, { data: responseData, ts: Date.now() });
          return res.json(responseData);
        }
      } catch (owmErr) {
        console.warn('OpenWeatherMap API error, falling back:', owmErr.message);
      }
    }

    // 2. Resilient Fallback (Open-Meteo or reverse geocode format if key not configured or fails)
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,surface_pressure&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=7`;
    const weatherRes = await fetchWithRetry(weatherUrl, {}, 2, 1000, 10000);
    const weatherData = await weatherRes.json();
    const current = weatherData.current || {};

    let locationName = q || 'Belagavi, IN';
    if (!q) {
      const geoCacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      const cachedGeo = _nominatimCache.get(geoCacheKey);
      if (cachedGeo && Date.now() - cachedGeo.ts < NOMINATIM_CACHE_TTL) {
        locationName = resolveWeatherLocationName(lat, lon, cachedGeo.name, q);
      } else {
        try {
          const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;
          const geoRes = await fetch(nominatimUrl, {
            headers: { 'User-Agent': 'SmartAgriCare/1.0' },
            signal: AbortSignal.timeout(5000),
          });
          if (geoRes.ok) {
            const geoData = await geoRes.json();
            const addr = geoData.address || {};
            const city = addr.city || addr.town || addr.municipality || addr.county || addr.state_district || addr.village || '';
            locationName = resolveWeatherLocationName(lat, lon, city, q);
            _nominatimCache.set(geoCacheKey, { name: locationName, ts: Date.now() });
          } else {
            locationName = resolveWeatherLocationName(lat, lon, '', q);
          }
        } catch {
          locationName = resolveWeatherLocationName(lat, lon, '', q);
        }
      }
    }

    const daily = weatherData.daily || {};
    const forecast = (daily.time || []).map((date, i) => ({
      date,
      tempMax: Math.round(daily.temperature_2m_max?.[i] ?? 0),
      tempMin: Math.round(daily.temperature_2m_min?.[i] ?? 0),
      precipitation: daily.precipitation_sum?.[i] ?? 0,
      condition: WEATHER_CODES[daily.weather_code?.[i]] || 'Cloudy',
      weatherCode: daily.weather_code?.[i] ?? 0,
    }));

    const cond = WEATHER_CODES[current.weather_code] || 'Cloudy';
    const nowIso = new Date().toISOString();
    const rainfallVal = current.precipitation ?? 0;

    const responseData = {
      success: true,
      weather: {
        location: locationName,
        temperature: Math.round(current.temperature_2m ?? 27),
        feels_like: Math.round(current.apparent_temperature ?? 28),
        feelsLike: Math.round(current.apparent_temperature ?? 28),
        humidity: Math.round(current.relative_humidity_2m ?? 72),
        rainfall: Number(rainfallVal.toFixed(1)),
        precipitation: Number(rainfallVal.toFixed(1)),
        wind_speed: Number((current.wind_speed_10m ?? 3.2).toFixed(1)),
        windSpeed: Number((current.wind_speed_10m ?? 3.2).toFixed(1)),
        wind_deg: current.wind_direction_10m ?? null,
        pressure: Math.round(current.surface_pressure ?? 1012),
        visibility: null, // Open-Meteo does not provide visibility
        weather_condition: cond,
        condition: cond,
        weather_description: cond.toLowerCase(),
        description: cond.toLowerCase(),
        weather_icon: 'https://openweathermap.org/img/wn/03d@2x.png',
        icon: 'https://openweathermap.org/img/wn/03d@2x.png',
        iconCode: '03d',
        source: 'Open-Meteo',
        last_updated: nowIso,
        lastUpdated: nowIso,
        lat,
        lon,
        forecast,
      },
    };

    _weatherCache.set(cacheKey, { data: responseData, ts: Date.now() });
    res.json(responseData);
  } catch (err) {
    console.error('Weather API error:', err.message);
    const cacheKey = `${Math.max(-90, Math.min(90, parseFloat(req.query.lat) || DEFAULT_WEATHER_LAT)).toFixed(2)},${Math.max(-180, Math.min(180, parseFloat(req.query.lng) || DEFAULT_WEATHER_LON)).toFixed(2)}`;
    const staleCache = _weatherCache.get(cacheKey);
    if (staleCache) {
      return res.json({ ...staleCache.data, _stale: true });
    }
    res.status(500).json({
      success: false,
      error: 'Unable to fetch weather. Please try again later.',
    });
  }
});

// --- Stores (OpenStreetMap Overpass + Karnataka Fertilizer Shops) ---
const storesRateLimit = rateLimit(60000, 15); // 15 store searches per minute per IP
// Cache Overpass results for 10 minutes to avoid slow/rate-limited external calls
const _storesCache = new Map(); // key: "lat,lng" (rounded to 2 decimals) → { ts, data }
const STORES_CACHE_TTL = 10 * 60 * 1000;

// Karnataka districts list for location matching
const KARNATAKA_DISTRICTS = [
  'Bagalkot', 'Belagavi', 'Davanagere', 'Dharwad', 'Gadag', 'Haveri',
  'Chitradurga', 'Uttara Kannada', 'Vijayapura', 'Shivamogga', 'Chikkaballapur'
];

// Karnataka district GPS coordinates mapping
const KARNATAKA_DISTRICT_COORDS = {
  'Bagalkot': { lat: 16.1867, lng: 75.6961 },
  'Belagavi': { lat: 15.8497, lng: 74.4977 },
  'Davanagere': { lat: 14.4644, lng: 75.9218 },
  'Dharwad': { lat: 15.4589, lng: 75.0078 },
  'Gadag': { lat: 15.4166, lng: 75.6270 },
  'Haveri': { lat: 14.7951, lng: 75.3991 },
  'Chitradurga': { lat: 14.2251, lng: 76.3980 },
  'Uttara Kannada': { lat: 14.8136, lng: 74.1295 },
  'Vijayapura': { lat: 16.8302, lng: 75.7100 },
  'Shivamogga': { lat: 13.9299, lng: 75.5681 },
  'Chikkaballapur': { lat: 13.4355, lng: 77.7315 }
};

app.get('/api/stores/nearby', storesRateLimit, async (req, res) => {
  try {
    const requestedLat = parseFloat(req.query.lat);
    const requestedLng = parseFloat(req.query.lng);
    const hasUserCoordinates = Number.isFinite(requestedLat) && Number.isFinite(requestedLng);
    const district = typeof req.query.district === 'string' ? req.query.district.trim() : '';
    const radius = Math.min(parseInt(req.query.radius) || 30000, 50000); // 30km default, 50km max

    const matchedDistrict = KARNATAKA_DISTRICTS.find(
      name => name.toLowerCase() === district.toLowerCase()
    );
    if (!hasUserCoordinates && !matchedDistrict) {
      return res.status(400).json({
        success: false,
        error: 'Share your location or select a Karnataka district to find stores.',
      });
    }

    const districtCenter = matchedDistrict ? KARNATAKA_DISTRICT_COORDS[matchedDistrict] : null;
    const lat = hasUserCoordinates
      ? Math.max(-90, Math.min(90, requestedLat))
      : districtCenter.lat;
    const lng = hasUserCoordinates
      ? Math.max(-180, Math.min(180, requestedLng))
      : districtCenter.lng;

    console.log(`Stores API called with lat: ${lat}, lng: ${lng}, district: ${district}`);

    // Check cache (rounded to 2 decimal places ≈ 1km grid)
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${radius},${district}`;
    const cached = _storesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < STORES_CACHE_TTL) {
      return res.json(cached.data);
    }

    // Get Karnataka fertilizer shops (all shops from database)
    const karnatakaShops = KARNATAKA_FERTILIZER_SHOPS.map((shop, i) => ({
      id: `ka_${i}`,
      name: shop.name,
      category: 'Seeds & Fertilizers',
      rating: null,
      distance: 0, // Will be calculated
      distanceKm: 0,
      lat: shop.lat,
      lon: shop.lng,
      phone: shop.phone,
      district: shop.district,
      source: 'karnataka_database'
    }));

    // Calculate distances for Karnataka shops
    const karnatakaStoresWithDist = karnatakaShops.map(shop => {
      const dist = haversine(lat, lng, shop.lat, shop.lon);
      return {
        ...shop,
        distance: dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`,
        distanceKm: dist,
        lng: shop.lon,
        address: `${shop.district}, Karnataka (approximate district-center pin)`,
        locationApproximate: true,
        open: null
      };
    });

    // If a Karnataka district was matched, only show shops from that district
    if (matchedDistrict) {
      const districtShops = karnatakaStoresWithDist.filter(s =>
        s.district.toLowerCase() === matchedDistrict.toLowerCase()
      );
      if (districtShops.length > 0) {
        // Sort by distance within the district
        districtShops.sort((a, b) => a.distanceKm - b.distanceKm);
        const result = { success: true, stores: districtShops, count: districtShops.length };
        _storesCache.set(cacheKey, { ts: Date.now(), data: result });
        console.log(`Returning ${districtShops.length} shops from matched district: ${matchedDistrict}`);
        return res.json(result);
      }
    }

    console.log(`Karnataka shops found: ${karnatakaStoresWithDist.length}, closest: ${karnatakaStoresWithDist[0]?.distance}`); // Debug log

    // Overpass API query — broader search for agricultural stores in India
    // Covers: agrarian shops, farm supply shops, garden centres, pesticide/fertilizer shops,
    // plus name-based matching for common Indian agricultural store names
    const query = `
      [out:json][timeout:15];
      (
        node["shop"="agrarian"](around:${radius},${lat},${lng});
        node["shop"="farm"](around:${radius},${lat},${lng});
        node["shop"="garden_centre"](around:${radius},${lat},${lng});
        node["shop"="doityourself"]["name"~"[Aa]gri|[Ff]arm|[Ss]eed|[Pp]esticide",i](around:${radius},${lat},${lng});
        node["shop"~"chemist|hardware"]["name"~"[Aa]gri|[Ff]ertili|[Pp]esticide|[Kk]isan",i](around:${radius},${lat},${lng});
        node["name"~"agri|seed|fertiliz|kisan|farm supply|pesticide|krishi|vyavasaya|rythu|nursery",i](around:${radius},${lat},${lng});
        way["shop"="agrarian"](around:${radius},${lat},${lng});
        way["shop"="farm"](around:${radius},${lat},${lng});
        way["name"~"agri|seed|fertiliz|kisan|farm supply|pesticide|krishi|nursery",i](around:${radius},${lat},${lng});
      );
      out center body;
    `;

    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const response = await fetch(overpassUrl, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
    const data = await response.json();

    // Haversine distance calculation
    const toRad = deg => deg * Math.PI / 180;
    const haversine = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const seen = new Set(); // Deduplicate by name+location
    const osmStores = (data.elements || [])
      .filter(el => el.tags?.name)
      .map((el, i) => {
        // For ways, use center coordinates
        const elLat = el.lat || el.center?.lat;
        const elLon = el.lon || el.center?.lon;
        if (!elLat || !elLon) return null;

        const dedupeKey = `${el.tags.name.toLowerCase()}_${elLat.toFixed(3)}_${elLon.toFixed(3)}`;
        if (seen.has(dedupeKey)) return null;
        seen.add(dedupeKey);

        const dist = haversine(lat, lng, elLat, elLon);
        const nameL = el.tags.name.toLowerCase();
        let category = 'Agricultural';
        if (el.tags.shop === 'agrarian' || /seed|fertiliz|kisan|krishi/.test(nameL)) category = 'Seeds & Fertilizers';
        else if (el.tags.shop === 'farm' || /farm supply|farm equip/.test(nameL)) category = 'Farm Supplies';
        else if (el.tags.shop === 'garden_centre' || /nursery|garden/.test(nameL)) category = 'Nursery & Garden';
        else if (/pesticide/.test(nameL)) category = 'Pesticides & Chemicals';

        return {
          id: el.id || i + 1,
          name: el.tags.name,
          category,
          rating: (3.5 + ((el.id || i) * 7 % 15) / 10).toFixed(1),
          distance: dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`,
          distanceKm: dist,
          address: [el.tags['addr:street'], el.tags['addr:city'] || el.tags['addr:suburb'], el.tags['addr:state']].filter(Boolean).join(', ') || '',
          phone: el.tags.phone || el.tags['contact:phone'] || '',
          open: el.tags.opening_hours ? !el.tags.opening_hours.includes('off') : null,
          lat: elLat,
          lng: elLon,
          source: 'osm'
        };
      })
      .filter(Boolean);

    // Check if user is in Karnataka (approximate bounds: 11.5°N to 18.5°N, 74°E to 78.5°E)
    const isInKarnataka = lat >= 11.5 && lat <= 18.5 && lng >= 74 && lng <= 78.5;

    // Merge stores: if in Karnataka, show Karnataka shops prioritized by distance
    let allStores;
    if (isInKarnataka) {
      // Always show Karnataka shops when in Karnataka, sorted by distance
      // Prioritize shops from the closest district
      allStores = karnatakaStoresWithDist.sort((a, b) => a.distanceKm - b.distanceKm);
    } else {
      // Show Karnataka shops if within 300km, otherwise OSM only
      const nearbyKarnataka = karnatakaStoresWithDist.filter(s => s.distanceKm <= 300);
      allStores = [...nearbyKarnataka, ...osmStores];
    }

    // Sort by distance and limit to 30
    const stores = allStores
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 30);

    // If no stores found, use Karnataka shops as fallback
    if (stores.length === 0) {
      const fallbackStores = karnatakaStoresWithDist
        .filter(s => matchedDistrict
          ? s.district.toLowerCase() === matchedDistrict.toLowerCase()
          : s.distanceKm <= 300)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 10);

      if (fallbackStores.length > 0) {
        const fallbackResult = { success: true, stores: fallbackStores, count: fallbackStores.length };
        _storesCache.set(cacheKey, { ts: Date.now(), data: fallbackResult });
        return res.json(fallbackResult);
      }
    }

    const result = { success: true, stores, count: stores.length };
    _storesCache.set(cacheKey, { ts: Date.now(), data: result });
    res.json(result);
  } catch (err) {
    console.error('Stores API error:', err.message);
    // Fall back only to the supplied Karnataka directory; never substitute another city.
    const requestedLat = parseFloat(req.query.lat);
    const requestedLng = parseFloat(req.query.lng);
    const hasUserCoordinates = Number.isFinite(requestedLat) && Number.isFinite(requestedLng);
    const district = typeof req.query.district === 'string' ? req.query.district.trim() : '';
    const matchedDistrict = KARNATAKA_DISTRICTS.find(
      name => name.toLowerCase() === district.toLowerCase()
    );
    const districtCenter = matchedDistrict ? KARNATAKA_DISTRICT_COORDS[matchedDistrict] : null;
    const lat = hasUserCoordinates ? requestedLat : districtCenter?.lat;
    const lng = hasUserCoordinates ? requestedLng : districtCenter?.lng;
    if (lat === undefined || lng === undefined) {
      return res.status(502).json({
        success: false,
        error: 'Unable to find stores for this location. Please try again.',
      });
    }
    const toRadF = deg => deg * Math.PI / 180;
    const havF = (lat1, lon1, lat2, lon2) => {
      const R = 6371, dLat = toRadF(lat2 - lat1), dLon = toRadF(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadF(lat1)) * Math.cos(toRadF(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const fallback = KARNATAKA_FERTILIZER_SHOPS
      .filter(shop => !matchedDistrict || shop.district.toLowerCase() === matchedDistrict.toLowerCase())
      .map((shop, i) => {
        const distanceKm = havF(lat, lng, shop.lat, shop.lng);
        return {
          id: `ka_${i}`,
          name: shop.name,
          category: 'Seeds & Fertilizers',
          rating: null,
          address: `${shop.district}, Karnataka (approximate district-center pin)`,
          phone: shop.phone,
          open: null,
          lat: shop.lat,
          lng: shop.lng,
          locationApproximate: true,
          distanceKm,
          distance: distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`,
          source: 'karnataka_database',
        };
      })
      .filter(shop => matchedDistrict || shop.distanceKm <= 300)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 10);
    if (fallback.length > 0) {
      return res.json({ success: true, stores: fallback, count: fallback.length });
    }
    return res.status(502).json({
      success: false,
      error: 'Unable to find stores for this location. Please try again.',
    });
  }
});

app.get('/api/stores/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  // Search is now handled client-side from the nearby results
  res.json({ success: true, stores: [] });
});

// --- TTS proxy (bypasses CORS for Google Translate TTS) ---
const ttsRateLimit = rateLimit(60000, 30); // 30 TTS requests per minute per IP
app.get('/api/tts', ttsRateLimit, async (req, res) => {
  const text = req.query.text || '';
  const VALID_TTS_LANGS = ['en', 'hi', 'te', 'kn', 'mr'];
  const lang = VALID_TTS_LANGS.includes(req.query.lang) ? req.query.lang : 'en';
  if (!text || text.length > 500) return res.status(400).json({ error: 'text required (max 500 chars)' });

  const encoded = encodeURIComponent(text);

  // 'gtx' client works for all languages including hi, te, mr, kn
  // 'tw-ob' times out for Hindi/Marathi/Telugu on some networks
  const CLIENTS = ['gtx', 'tw-ob', 't'];

  for (const client of CLIENTS) {
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=${client}&tl=${lang}&q=${encoded}`;
    try {
      const response = await fetch(ttsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
          'Accept': 'audio/mpeg, audio/*',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength < 512) continue; // too small = probably an error page
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    } catch (err) {
      // Try next client
      continue;
    }
  }

  console.error('TTS proxy: all clients failed for lang=' + lang);
  res.status(500).json({ error: 'TTS unavailable' });
});

// --- Voice (Groq + Gemini + SambaNova cascade) ---

const VOICE_SYSTEM_PROMPT = `You are SmartAgriCare, a friendly and knowledgeable AI voice assistant.
You can answer ANY question - science, health, cooking, farming, technology,
history, general knowledge, daily life, current events, and more.

RULES you must always follow:
1. Reply ONLY in the same language the user used.
   - User writes in Hindi (Devanagari) -> reply fully in Hindi.
   - User writes in Telugu script -> reply fully in Telugu.
   - User writes in English -> reply in English.
2. CONTEXT RULE - very important: Always read the full conversation history above.
   If the user says something like "describe it", "explain more", "tell me more",
   "in detail", "elaborate", "what else", "continue", "and then", "why", "how",
   or any follow-up phrase - they are referring to YOUR PREVIOUS answer.
   Never ask the user what they mean. Just expand on the previous topic directly.
3. LENGTH RULE:
   - For normal questions: keep it SHORT, 2 to 3 sentences.
   - If the user asks for "detail", "describe", "explain", "elaborate", or "more":
     give a fuller answer of 4 to 6 sentences, but still concise.
4. Do NOT use any markdown: no asterisks, hashes, dashes, bullets, or numbered lists.
5. Do NOT use special symbols such as * # - | [ ] ( ) / \\
6. Write plain conversational sentences only - as if talking out loud.
7. Be warm, friendly, and easy to understand.`;

const DETAIL_KEYWORDS = [
  'describe', 'detail', 'explain', 'elaborate', 'more', 'tell me more',
  'in detail', 'go on', 'continue', 'expand', 'what else', 'and then',
  'further', 'briefly explain', 'describe it', 'explain it', 'about it',
  'describe me', 'explain me',
  // Hindi
  'विस्तार', 'बताओ', 'समझाओ', 'और बताओ', 'विवरण', 'जारी', 'विस्तार से', 'और', 'ज्यादा',
  // Telugu
  'వివరంగా', 'చెప్పు', 'వివరించు', 'ఇంకా', 'మరింత', 'విపులంగా', 'వివరం', 'కొనసాగించు',
  // Kannada
  'ವಿವರಿಸು', 'ಹೆಚ್ಚು', 'ಮುಂದುವರಿ', 'ವಿಸ್ತಾರ', 'ಹೇಳು', 'ವಿವರ', 'ಇನ್ನಷ್ಟು',
  // Marathi
  'सांग', 'समजाव', 'विस्तार', 'अजून', 'पुढे', 'सविस्तर', 'जास्त',
];

function isDetailRequest(text) {
  const norm = text.toLowerCase().normalize('NFC');
  return DETAIL_KEYWORDS.some(kw => norm.includes(kw.toLowerCase().normalize('NFC')));
}

const LANG_DISPLAY = {
  en: 'English',
  hi: 'Hindi (Devanagari script)',
  te: 'Telugu (Telugu script)',
  kn: 'Kannada (Kannada script)',
  mr: 'Marathi (Devanagari script)',
};

function cleanForTts(text) {
  text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  text = text.replace(/\*{1,3}(.*?)\*{1,3}/gs, '$1');
  text = text.replace(/_{1,2}(.*?)_{1,2}/gs, '$1');
  text = text.replace(/`+.*?`+/gs, '');
  text = text.replace(/^\s*#{1,6}\s*/gm, '');
  text = text.replace(/^\s*[-\u2022*>|]+\s*/gm, '');
  text = text.replace(/^\s*\d+[.)]\s*/gm, '');
  // Keep only safe characters for TTS: ASCII word chars, whitespace, punctuation,
  // and all Indic script Unicode blocks needed for Indian languages
  text = text.replace(/[^\w\s.,!?'\u0900-\u097F\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0964\u0965]/gu, ' ');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

async function askLLM(userText, history, langCode, weatherContext = null, farmerProfile = null) {
  const langName = LANG_DISPLAY[langCode] || 'English';
  const wantsDetail = isDetailRequest(userText) && history.length > 0;

  const lengthInstruction = wantsDetail
    ? 'The user is asking you to expand on your PREVIOUS answer. Look at the conversation history and give a fuller explanation of the same topic in 4 to 6 sentences. Do NOT ask the user what they mean - just elaborate directly.'
    : 'Keep the answer short: 2 to 3 sentences maximum.';
  const maxTokens = wantsDetail ? 512 : 256;

  // Build farmer profile context (Feature #9)
  let profilePrompt = '';
  if (farmerProfile && typeof farmerProfile === 'object') {
    const parts = [];
    if (farmerProfile.crop) parts.push(`grows ${farmerProfile.crop}`);
    if (farmerProfile.soil) parts.push(`uses ${farmerProfile.soil} soil`);
    if (farmerProfile.district) parts.push(`located in ${farmerProfile.district}`);
    if (farmerProfile.landAcres) parts.push(`has ${farmerProfile.landAcres} acres`);
    if (parts.length > 0) {
      profilePrompt = `\n\nFARMER PROFILE (use this context for all answers): This farmer ${parts.join(', ')}. Tailor every answer to their specific crop and location.`;
    }
  }

  let weatherPrompt = '';
  if (weatherContext && typeof weatherContext === 'object') {
    const loc = weatherContext.location || 'Belagavi, IN';
    const temp = weatherContext.temperature ?? 27;
    const feels = weatherContext.feelsLike ?? weatherContext.feels_like ?? temp;
    const cond = weatherContext.condition || weatherContext.weather_condition || 'Cloudy';
    const desc = weatherContext.description || weatherContext.weather_description || 'cloudy';
    const hum = weatherContext.humidity ?? 72;
    const rain = weatherContext.rainfall ?? 0;
    const wind = weatherContext.windSpeed ?? weatherContext.wind_speed ?? 3.2;
    const press = weatherContext.pressure ?? 1012;

    weatherPrompt = `\n\nREAL-TIME LIVE WEATHER AT FARMER LOCATION:
- Location: ${loc}
- Temperature: ${temp}°C (Feels like: ${feels}°C)
- Condition: ${cond} (${desc})
- Humidity: ${hum}%
- Rainfall: ${rain} mm
- Wind Speed: ${wind} m/s
- Pressure: ${press} hPa

Use this live weather data to accurately answer any questions such as "What is the weather today?", "Should I irrigate my crop today?", or climate advisories.`;
  }

  const systemContent = VOICE_SYSTEM_PROMPT +
    `\n\nCurrent language: ${langName}. Reply ONLY in ${langName}. ${lengthInstruction} No special characters, no markdown, no bullet points.${weatherPrompt}${profilePrompt}`;

  // Build OpenAI-compatible message history (used by Groq and SambaNova)
  const openaiMessages = [{ role: 'system', content: systemContent }];
  for (const msg of history.slice(-10)) {
    openaiMessages.push({ role: msg.role, content: msg.content });
  }
  openaiMessages.push({ role: 'user', content: userText });

  // ── Try Groq first (primary) ──
  if (GROQ_API_KEY) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: openaiMessages,
          temperature: 0.6,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Groq API ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) throw new Error('Empty response from Groq');
      console.log('Voice response via Groq');
      return cleanForTts(text.trim());
    } catch (err) {
      console.error('Groq error:', err.message || err);
    }
  }

  // ── Fallback 1: Gemini ──
  if (GEMINI_API_KEY) {
    try {
      // Build Gemini conversation history (Gemini uses "model" instead of "assistant")
      const contents = [];
      for (const msg of history.slice(-10)) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
      contents.push({ role: 'user', parts: [{ text: userText }] });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemContent }] },
          contents,
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: maxTokens,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Gemini API ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) throw new Error('Empty response from Gemini');
      console.log('Voice response via Gemini');
      return cleanForTts(text.trim());
    } catch (err) {
      console.error('Gemini error:', err.message || err);
    }
  }

  // ── Fallback 2: SambaNova ──
  if (SAMBANOVA_API_KEY) {
    try {
      const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SAMBANOVA_API_KEY}`,
        },
        body: JSON.stringify({
          model: SAMBANOVA_MODEL,
          messages: openaiMessages,
          temperature: 0.6,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`SambaNova API ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) throw new Error('Empty response from SambaNova');
      console.log('Voice response via SambaNova');
      return cleanForTts(text.trim());
    } catch (err) {
      console.error('SambaNova error:', err.message || err);
    }
  }

  // ── All providers failed ──
  const errorMessages = {
    en: 'Sorry, I could not get a response right now. Please try again shortly.',
    hi: 'माफ करें, अभी जवाब नहीं मिल सका। कृपया थोड़ी देर बाद पुनः प्रयास करें।',
    te: 'క్షమించండి, ఇప్పుడు సమాధానం రాలేదు. దయచేసి కొద్దిసేపట్లో మళ్ళీ ప్రయత్నించండి.',
    kn: 'ಕ್ಷಮಿಸಿ, ಈಗ ಉತ್ತರ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    mr: 'माफ करा, आत्ता उत्तर मिळाले नाही. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.',
  };
  return errorMessages[langCode] || errorMessages.en;
}

// --- Voice: Save conversation history (Feature #4) ---
app.post('/api/voice/history/save', requireAuth, async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ success: false, error: 'messages array required' });
  try {
    const db = await getDb();
    const safeMessages = messages
      .filter(m => m && typeof m.role === 'string' && typeof m.text === 'string')
      .slice(-50) // Keep last 50 messages
      .map(m => ({ role: m.role, text: m.text.slice(0, 2000), timestamp: m.timestamp || Date.now() }));
    const key = `voice_history_${req.userId}`;
    await save(key, JSON.stringify({ userId: req.userId, messages: safeMessages, savedAt: new Date().toISOString() }));
    res.json({ success: true });
  } catch (err) {
    console.error('Save voice history error:', err);
    res.status(500).json({ success: false, error: 'Failed to save history' });
  }
});

app.get('/api/voice/history', requireAuth, async (req, res) => {
  try {
    const key = `voice_history_${req.userId}`;
    const db = await getDb();
    // For SQLite: look up in kv table; for Mongo: handled by save/get
    let raw = null;
    try {
      // Try generic get — works for both SQLite kv and Mongo
      if (db.get) raw = await db.get(key);
      else if (db.collection) {
        const doc = await db.collection('kv').findOne({ key });
        raw = doc?.value;
      }
    } catch { /* no history yet */ }
    if (!raw) return res.json({ success: true, messages: [] });
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    res.json({ success: true, messages: parsed.messages || [] });
  } catch (err) {
    console.error('Get voice history error:', err);
    res.json({ success: true, messages: [] }); // Fail gracefully
  }
});

// --- Voice: Market price query (Feature #3) ---
const marketRateLimit = rateLimit(60000, 20);
app.get('/api/voice/market-price', marketRateLimit, async (req, res) => {
  const { crop } = req.query;
  if (!crop) return res.status(400).json({ success: false, error: 'crop name required' });

  // Static MSP (Minimum Support Price) data — FY 2024-25 government MSP rates
  const MSP_DATA = {
    'rice': { crop: 'Rice (Paddy)', msp: 2300, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'paddy': { crop: 'Rice (Paddy)', msp: 2300, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'wheat': { crop: 'Wheat', msp: 2275, unit: 'per quintal', season: 'Rabi 2024-25', source: 'CACP India' },
    'maize': { crop: 'Maize', msp: 2090, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'cotton': { crop: 'Cotton (Medium Staple)', msp: 7121, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'groundnut': { crop: 'Groundnut', msp: 6377, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'soybean': { crop: 'Soybean', msp: 4892, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'soya': { crop: 'Soybean', msp: 4892, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'sunflower': { crop: 'Sunflower', msp: 5650, unit: 'per quintal', season: 'Rabi 2024-25', source: 'CACP India' },
    'jowar': { crop: 'Jowar (Sorghum)', msp: 3180, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'sorghum': { crop: 'Jowar (Sorghum)', msp: 3180, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'bajra': { crop: 'Bajra (Pearl Millet)', msp: 2500, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'ragi': { crop: 'Ragi (Finger Millet)', msp: 3846, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'tur': { crop: 'Tur Dal (Arhar)', msp: 7000, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'arhar': { crop: 'Tur Dal (Arhar)', msp: 7000, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'moong': { crop: 'Green Gram (Moong)', msp: 8558, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'greengram': { crop: 'Green Gram (Moong)', msp: 8558, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'urad': { crop: 'Black Gram (Urad)', msp: 6950, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'blackgram': { crop: 'Black Gram (Urad)', msp: 6950, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'chickpea': { crop: 'Chickpea (Bengal Gram)', msp: 5440, unit: 'per quintal', season: 'Rabi 2024-25', source: 'CACP India' },
    'chana': { crop: 'Chickpea (Bengal Gram)', msp: 5440, unit: 'per quintal', season: 'Rabi 2024-25', source: 'CACP India' },
    'mustard': { crop: 'Mustard & Rapeseed', msp: 5650, unit: 'per quintal', season: 'Rabi 2024-25', source: 'CACP India' },
    'sugarcane': { crop: 'Sugarcane', msp: 315, unit: 'per quintal (FRP)', season: '2024-25', source: 'CACP India' },
    'sesame': { crop: 'Sesame (Til)', msp: 8635, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'til': { crop: 'Sesame (Til)', msp: 8635, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'jute': { crop: 'Jute', msp: 5335, unit: 'per quintal', season: 'Kharif 2024-25', source: 'CACP India' },
    'safflower': { crop: 'Safflower', msp: 5800, unit: 'per quintal', season: 'Rabi 2024-25', source: 'CACP India' },
    'lentil': { crop: 'Lentil (Masur)', msp: 6425, unit: 'per quintal', season: 'Rabi 2024-25', source: 'CACP India' },
    'masur': { crop: 'Lentil (Masur)', msp: 6425, unit: 'per quintal', season: 'Rabi 2024-25', source: 'CACP India' },
  };

  const key = crop.toString().toLowerCase().trim().replace(/\s+/g, '');
  const found = MSP_DATA[key];
  if (found) {
    return res.json({ success: true, ...found });
  }
  // Fuzzy match
  const fuzzy = Object.entries(MSP_DATA).find(([k]) => k.includes(key) || key.includes(k));
  if (fuzzy) {
    return res.json({ success: true, ...fuzzy[1] });
  }
  res.json({ success: false, error: `MSP data not available for "${crop}". Available: rice, wheat, cotton, groundnut, maize, tur, moong, urad, chickpea, mustard, sugarcane, and more.` });
});

const voiceRateLimit = rateLimit(60000, 15); // 15 voice queries per minute per IP
app.post('/api/voice/query', voiceRateLimit, async (req, res) => {
  const { query, language, history, weatherContext, farmerProfile } = req.body;
  if (!query) return res.status(400).json({ success: false, error: 'Query is required' });
  if (typeof query !== 'string' || query.length > 2000) return res.status(400).json({ success: false, error: 'Query too long (max 2000 chars)' });

  const lang = language || 'en';
  const safeHistory = Array.isArray(history)
    ? history
        .filter(h => h && typeof h.role === 'string' && typeof h.content === 'string')
        .filter(h => ['user', 'assistant'].includes(h.role))
        .map(h => ({ role: h.role, content: h.content.slice(0, 2000) }))
        .slice(-10)
    : [];

  try {
    // Sanitize farmer profile (Feature #9)
    const safeProfile = (farmerProfile && typeof farmerProfile === 'object') ? {
      crop: typeof farmerProfile.crop === 'string' ? farmerProfile.crop.slice(0, 100) : null,
      soil: typeof farmerProfile.soil === 'string' ? farmerProfile.soil.slice(0, 100) : null,
      district: typeof farmerProfile.district === 'string' ? farmerProfile.district.slice(0, 100) : null,
      landAcres: typeof farmerProfile.landAcres === 'string' ? farmerProfile.landAcres.slice(0, 20) : null,
    } : null;
    const response = await askLLM(query, safeHistory, lang, weatherContext, safeProfile);
    res.json({ success: true, response, language: lang });
  } catch (err) {
    console.error('Voice query error:', err);
    const fallback = { en: 'Sorry, I encountered an error. Please try again.', hi: 'माफ करें, एक त्रुटि हुई। कृपया पुनः प्रयास करें।', te: 'క్షमించండి, లోపం జరిగింది. దయచేసి మళ్ళీ ప్రయత్నించండి.' };
    res.status(500).json({ success: false, error: fallback[lang] || fallback.en, language: lang });
  }
});

// --- Global error handler (catches JSON parse errors, etc.) ---
// --- API 404 handler (before error handler and SPA catch-all) ---
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON in request body' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// --- Serve frontend static files (production) ---
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist, {
  maxAge: IS_PROD ? '7d' : 0,       // Vite hashed assets cache for 7 days
  immutable: IS_PROD,
}));
app.use((_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// --- Start server ---
async function start() {
  await getDb();

  // Check ML service availability (non-blocking) using shared status helper
  const st = await getMlServiceStatus();
  if (st.status === 'ready') {
    console.log('ML service: CONNECTED', `(${st.classes} classes, val_acc ${st.valAcc})`);
  } else if (st.status === 'degraded') {
    console.warn('ML service: DEGRADED (ML-service running, but model not loaded.)');
    console.warn('  Reason:', st.modelError || st.reason);
    console.warn('  Disease detection will return errors until the model weights file is available.');
  } else {
    console.warn('ML service: OFFLINE at', ML_SERVICE_URL);
    console.warn('  Reason:', st.reason);
    console.warn('  Disease detection will return errors until ML service is ready.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SmartAgriCare Backend running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`API available at http://0.0.0.0:${PORT}`);
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
