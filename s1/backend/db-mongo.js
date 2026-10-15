/**
 * MongoDB database layer (Atlas free tier / Student Dev Pack).
 * Provides the same interface as db.js (SQLite) for seamless switching.
 * Set MONGODB_URI env var to enable.
 */
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
    tls: true,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
});
let db;
let initialized = false;

async function getDb() {
    if (!initialized) {
        try {
            await client.connect();
        } catch (err) {
            // Provide clear, actionable error messages
            if (err.code === 8000 || err.message?.includes('auth')) {
                console.error('\n╔═══════════════════════════════════════════════════════════════╗');
                console.error('║  MongoDB Authentication Failed                                 ║');
                console.error('╠═══════════════════════════════════════════════════════════════╣');
                console.error('║  Please check your MONGODB_URI in Render environment vars:    ║');
                console.error('║                                                               ║');
                console.error('║  1. Go to Render Dashboard → Your Service → Environment       ║');
                console.error('║  2. Check MONGODB_URI has correct username:password           ║');
                console.error('║  3. Ensure password is URL-encoded (@ → %40, etc.)            ║');
                console.error('║  4. Verify MongoDB Atlas user has readWrite permissions       ║');
                console.error('║  5. Check Atlas Network Access allows 0.0.0.0/0               ║');
                console.error('╚═══════════════════════════════════════════════════════════════╝\n');
            }
            throw err;
        }
        db = client.db('smartagricare');

        // Create indexes
        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('auth_tokens').createIndex({ token: 1 }, { unique: true });
        await db.collection('auth_tokens').createIndex({ user_id: 1 });
        await db.collection('auth_tokens').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
        await db.collection('password_reset_tokens').createIndex({ email: 1, token: 1 });
        await db.collection('password_reset_tokens').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
        await db.collection('disease_reports').createIndex({ user_id: 1, created_at: -1 });
        await db.collection('soil_inquiries').createIndex({ user_id: 1, created_at: -1 });
        await db.collection('crop_recommendations').createIndex({ user_id: 1, created_at: -1 });

        // Counter collection for auto-increment IDs
        const counters = db.collection('counters');
        for (const name of ['users', 'disease_reports', 'soil_inquiries', 'password_reset_tokens', 'crop_recommendations']) {
            await counters.updateOne(
                { _id: name },
                { $setOnInsert: { seq: 0 } },
                { upsert: true }
            );
        }

        initialized = true;
        console.log('MongoDB connected & indexes created');
    }
    return db;
}

async function nextId(collection) {
    const result = await db.collection('counters').findOneAndUpdate(
        { _id: collection },
        { $inc: { seq: 1 } },
        { returnDocument: 'after' }
    );
    return result.seq;
}

function save() { /* no-op for MongoDB */ }
function flushSave() { /* no-op for MongoDB */ }

// --- User helpers ---
async function createUser(name, email, passwordHash, phone = '', location = '') {
    const id = await nextId('users');
    const doc = {
        id, name, email, password_hash: passwordHash,
        phone: phone || '', location: location || '',
        created_at: new Date(),
    };
    await db.collection('users').insertOne(doc);
    return { id: doc.id, name: doc.name, email: doc.email, phone: doc.phone, location: doc.location };
}

async function findUserByEmail(email) {
    const user = await db.collection('users').findOne({ email });
    if (!user) return null;
    return {
        id: user.id, name: user.name, email: user.email,
        password_hash: user.password_hash,
        phone: user.phone || '', location: user.location || '',
    };
}

// --- Disease report helpers ---
function safeParse(val) {
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val || '[]'); } catch { return []; }
}

async function saveDiseaseReport(userId, report) {
    const id = await nextId('disease_reports');
    await db.collection('disease_reports').insertOne({
        id, user_id: userId,
        disease: report.disease, confidence: report.confidence,
        cause: report.cause,
        treatment: report.treatment || [],
        stores: report.stores || [],
        image_name: report.imageName || '',
        crop: report.crop || '',
        crop_image: report.cropImage || '',
        status: report.status || '',
        severity_level: report.severityLevel || '',
        symptoms: report.symptoms || [],
        possible_causes: report.possibleCauses || '',
        preventive_measures: report.preventiveMeasures || [],
        recommendation: report.recommendation || null,
        created_at: new Date(),
    });
    return id;
}

async function getUserReports(userId, limit = 50, offset = 0) {
    const docs = await db.collection('disease_reports')
        .find({ user_id: userId })
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
    return docs.map(r => ({
        id: r.id, disease: r.disease, confidence: r.confidence, cause: r.cause,
        treatment: safeParse(r.treatment), stores: safeParse(r.stores),
        imageName: r.image_name, createdAt: r.created_at,
        crop: r.crop || '', cropImage: r.crop_image || '', status: r.status || '',
        severityLevel: r.severity_level || '',
        symptoms: safeParse(r.symptoms), possibleCauses: r.possible_causes || '',
        preventiveMeasures: safeParse(r.preventive_measures),
        recommendation: r.recommendation || null,
    }));
}

async function saveSoilInquiry(userId, inquiry) {
    const id = await nextId('soil_inquiries');
    await db.collection('soil_inquiries').insertOne({
        id, user_id: userId,
        name: inquiry.name, phone: inquiry.phone,
        village: inquiry.village || '', district: inquiry.district,
        land_acres: inquiry.landAcres ?? null,
        crop: inquiry.crop || '', soil_type: inquiry.soilType || '',
        notes: inquiry.notes || '', created_at: new Date(),
    });
    return id;
}

async function getUserSoilInquiries(userId, limit = 50, offset = 0) {
    const docs = await db.collection('soil_inquiries')
        .find({ user_id: userId })
        .sort({ created_at: -1, id: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
    return docs.map(r => ({
        id: r.id, name: r.name, phone: r.phone, village: r.village,
        district: r.district, landAcres: r.land_acres, crop: r.crop,
        soilType: r.soil_type, notes: r.notes, createdAt: r.created_at,
    }));
}

// --- Crop recommendation history helpers ---
async function saveCropRecommendation(userId, rec) {
    const id = await nextId('crop_recommendations');
    await db.collection('crop_recommendations').insertOne({
        id, user_id: userId,
        season: rec.season || '', soil: rec.soil || '', water: rec.water || '',
        district: rec.district || '', land: rec.land || '',
        top_crop: rec.topCrop || '', top_match: rec.topMatch || 0,
        results: rec.results || [],
        created_at: new Date(),
    });
    return id;
}

async function getUserCropRecommendations(userId, limit = 50, offset = 0) {
    const docs = await db.collection('crop_recommendations')
        .find({ user_id: userId })
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
    return docs.map(r => ({
        id: r.id, season: r.season, soil: r.soil, water: r.water,
        district: r.district, land: r.land, topCrop: r.top_crop,
        topMatch: r.top_match, results: r.results || [], createdAt: r.created_at,
    }));
}

// --- Password reset helpers ---
async function createResetToken(email, token, expiresAt) {
    const id = await nextId('password_reset_tokens');
    await db.collection('password_reset_tokens').insertOne({
        id, email, token, used: 0,
        expires_at: new Date(expiresAt),
        created_at: new Date(),
    });
}

async function findValidResetToken(email, token) {
    const doc = await db.collection('password_reset_tokens').findOne({
        email, token, used: 0,
        expires_at: { $gt: new Date() },
    });
    return doc ? doc.id : null;
}

async function markTokenUsed(tokenId) {
    await db.collection('password_reset_tokens').updateOne(
        { id: tokenId }, { $set: { used: 1 } }
    );
}

async function updateUserPassword(email, passwordHash) {
    await db.collection('users').updateOne(
        { email }, { $set: { password_hash: passwordHash } }
    );
}

async function updateUserProfile(userId, fields) {
    const allowed = ['name', 'phone', 'location'];
    const updates = {};
    for (const key of allowed) {
        if (fields[key] !== undefined) updates[key] = fields[key];
    }
    if (Object.keys(updates).length === 0) return false;
    await db.collection('users').updateOne({ id: userId }, { $set: updates });
    return true;
}

// --- Auth token helpers ---
async function saveAuthToken(token, userId, expiresAt) {
    await db.collection('auth_tokens').deleteMany({ user_id: userId });
    await db.collection('auth_tokens').insertOne({
        token, user_id: userId,
        expires_at: new Date(expiresAt),
        created_at: new Date(),
    });
}

async function findAuthToken(token) {
    const doc = await db.collection('auth_tokens').findOne({
        token, expires_at: { $gt: new Date() },
    });
    return doc ? doc.user_id : null;
}

async function deleteAuthToken(token) {
    await db.collection('auth_tokens').deleteOne({ token });
}

async function deleteAuthTokensByEmail(email) {
    const user = await db.collection('users').findOne({ email });
    if (user) {
        await db.collection('auth_tokens').deleteMany({ user_id: user.id });
    }
}

async function purgeExpiredAuthTokens() {
    // MongoDB TTL indexes handle this automatically, but clean up used reset tokens
    await db.collection('password_reset_tokens').deleteMany({
        $or: [{ used: 1 }, { expires_at: { $lte: new Date() } }],
    });
}

module.exports = {
    getDb, save, flushSave,
    createUser, findUserByEmail,
    saveDiseaseReport, getUserReports,
    saveSoilInquiry, getUserSoilInquiries,
    saveCropRecommendation, getUserCropRecommendations,
    createResetToken, findValidResetToken, markTokenUsed,
    updateUserPassword, updateUserProfile,
    saveAuthToken, findAuthToken, deleteAuthToken,
    deleteAuthTokensByEmail, purgeExpiredAuthTokens,
};
