/**
 * SQLite database layer using sql.js (pure JS, no native deps).
 * Data stored in backend/data/smartagricare.db
 */
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.SMARTAGRICARE_DB_PATH
    ? path.resolve(process.env.SMARTAGRICARE_DB_PATH)
    : path.join(__dirname, 'data', 'smartagricare.db');
const DB_DIR = path.dirname(DB_PATH);

let db = null;
let _dbPromise = null;
let _saveTimer = null;
let _dirty = false;

/** Debounced save — coalesces multiple mutations into a single disk write.
 *  Writes at most once per second under sustained load. */
function debouncedSave() {
    _dirty = true;
    if (_saveTimer) return; // already scheduled
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        if (_dirty) {
            _dirty = false;
            try {
                save();
            } catch (err) {
                console.error('Database save failed:', err.message);
                _dirty = true; // retry on next debounce
            }
        }
    }, 1000);
}

/** Flush any pending debounced save immediately (synchronous).
 *  Call this from shutdown handlers to prevent data loss. */
function flushSave() {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
    }
    if (_dirty) {
        _dirty = false;
        save();
    }
}

async function getDb() {
    if (db) return db;
    if (!_dbPromise) _dbPromise = _initDb();
    return _dbPromise;
}

async function _initDb() {
    const SQL = await initSqlJs();
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS disease_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      disease TEXT NOT NULL,
      confidence REAL,
      cause TEXT,
      treatment TEXT,
      stores TEXT,
      image_name TEXT,
      crop TEXT,
      crop_image TEXT,
      status TEXT,
      severity_level TEXT,
      symptoms TEXT,
      possible_causes TEXT,
      preventive_measures TEXT,
      recommendation TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS soil_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      village TEXT DEFAULT '',
      district TEXT NOT NULL,
      land_acres REAL,
      crop TEXT DEFAULT '',
      soil_type TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

    const alterColumns = [
      ['crop', 'TEXT'],
      ['crop_image', 'TEXT'],
      ['status', 'TEXT'],
      ['severity_level', 'TEXT'],
      ['symptoms', 'TEXT'],
      ['possible_causes', 'TEXT'],
      ['preventive_measures', 'TEXT'],
      ['recommendation', 'TEXT'],
    ];
    for (const [col, type] of alterColumns) {
      try {
        db.run(`ALTER TABLE disease_reports ADD COLUMN ${col} ${type}`);
      } catch (_err) { /* Column already exists */ }
    }

    db.run(`
    CREATE TABLE IF NOT EXISTS crop_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      season TEXT,
      soil TEXT,
      water TEXT,
      district TEXT,
      land TEXT,
      top_crop TEXT,
      top_match INTEGER,
      results_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

    // Indexes for frequently queried columns
    db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token)');
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_reset_tokens_email ON password_reset_tokens(email, token)');
    db.run('CREATE INDEX IF NOT EXISTS idx_reports_user ON disease_reports(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_soil_inquiries_user ON soil_inquiries(user_id, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_crop_recs_user ON crop_recommendations(user_id)');

    save();
    return db;
}

function save() {
    if (!db) return;
    const data = db.export();
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, data);  // Write Uint8Array directly (no extra Buffer copy)
    fs.renameSync(tmpPath, DB_PATH);
}

// --- User helpers (async for compatibility with PostgreSQL) ---
async function createUser(name, email, passwordHash, phone = '', location = '') {
    db.run('INSERT INTO users (name, email, password_hash, phone, location) VALUES (?, ?, ?, ?, ?)', [name, email, passwordHash, phone, location]);
    debouncedSave();
    const row = db.exec('SELECT id, name, email, phone, location FROM users WHERE email = ?', [email]);
    return row[0]?.values[0] ? { id: row[0].values[0][0], name: row[0].values[0][1], email: row[0].values[0][2], phone: row[0].values[0][3], location: row[0].values[0][4] } : null;
}

async function findUserByEmail(email) {
    const row = db.exec('SELECT id, name, email, password_hash, phone, location FROM users WHERE email = ?', [email]);
    if (!row[0]?.values[0]) return null;
    const [id, name, em, password_hash, phone, location] = row[0].values[0];
    return { id, name, email: em, password_hash, phone, location };
}

// --- Disease report helpers (async for compatibility with PostgreSQL) ---
function safeParse(val) {
    try { return JSON.parse(val || '[]'); } catch { return []; }
}

async function saveDiseaseReport(userId, report) {
    db.run(
        'INSERT INTO disease_reports (user_id, disease, confidence, cause, treatment, stores, image_name, crop, crop_image, status, severity_level, symptoms, possible_causes, preventive_measures, recommendation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            userId, report.disease, report.confidence, report.cause,
            JSON.stringify(report.treatment), JSON.stringify(report.stores), report.imageName || '',
            report.crop || '',
            report.cropImage || '',
            report.status || '',
            report.severityLevel || '',
            JSON.stringify(report.symptoms || []),
            report.possibleCauses || '',
            JSON.stringify(report.preventiveMeasures || []),
            typeof report.recommendation === 'object' ? JSON.stringify(report.recommendation) : (report.recommendation || '')
        ]
    );
    debouncedSave();
    const row = db.exec('SELECT last_insert_rowid()');
    return row[0]?.values[0]?.[0];
}

async function getUserReports(userId, limit = 50, offset = 0) {
    const rows = db.exec(
        'SELECT id, disease, confidence, cause, treatment, stores, image_name, created_at, crop, crop_image, status, severity_level, symptoms, possible_causes, preventive_measures, recommendation FROM disease_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [userId, limit, offset]
    );
    if (!rows[0]) return [];
    return rows[0].values.map(r => {
        const obj = {
            id: r[0], disease: r[1], confidence: r[2], cause: r[3],
            treatment: safeParse(r[4]), stores: safeParse(r[5]),
            imageName: r[6], createdAt: r[7],
            crop: r[8], cropImage: r[9], status: r[10], severityLevel: r[11],
            symptoms: safeParse(r[12]), possibleCauses: r[13],
            preventiveMeasures: safeParse(r[14]),
        };
        try {
            obj.recommendation = r[15] ? JSON.parse(r[15]) : null;
        } catch {
            obj.recommendation = r[15] || null;
        }
        return obj;
    });
}

async function saveSoilInquiry(userId, inquiry) {
    db.run(
        'INSERT INTO soil_inquiries (user_id, name, phone, village, district, land_acres, crop, soil_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            userId, inquiry.name, inquiry.phone, inquiry.village, inquiry.district,
            inquiry.landAcres, inquiry.crop, inquiry.soilType, inquiry.notes,
        ]
    );
    debouncedSave();
    const row = db.exec('SELECT last_insert_rowid()');
    return row[0]?.values[0]?.[0];
}

async function getUserSoilInquiries(userId, limit = 50, offset = 0) {
    const rows = db.exec(
        'SELECT id, name, phone, village, district, land_acres, crop, soil_type, notes, created_at FROM soil_inquiries WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
        [userId, limit, offset]
    );
    if (!rows[0]) return [];
    return rows[0].values.map(r => ({
        id: r[0], name: r[1], phone: r[2], village: r[3], district: r[4],
        landAcres: r[5], crop: r[6], soilType: r[7], notes: r[8], createdAt: r[9],
    }));
}

// --- Crop recommendation history helpers ---
async function saveCropRecommendation(userId, rec) {
    db.run(
        'INSERT INTO crop_recommendations (user_id, season, soil, water, district, land, top_crop, top_match, results_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            userId,
            rec.season || '',
            rec.soil || '',
            rec.water || '',
            rec.district || '',
            rec.land || '',
            rec.topCrop || '',
            rec.topMatch || 0,
            JSON.stringify(rec.results || [])
        ]
    );
    debouncedSave();
    const row = db.exec('SELECT last_insert_rowid()');
    return row[0]?.values[0]?.[0];
}

async function getUserCropRecommendations(userId, limit = 50, offset = 0) {
    const rows = db.exec(
        'SELECT id, season, soil, water, district, land, top_crop, top_match, results_json, created_at FROM crop_recommendations WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [userId, limit, offset]
    );
    if (!rows[0]) return [];
    return rows[0].values.map(r => {
        let results = [];
        try { results = r[8] ? JSON.parse(r[8]) : []; } catch { results = []; }
        return {
            id: r[0], season: r[1], soil: r[2], water: r[3], district: r[4],
            land: r[5], topCrop: r[6], topMatch: r[7], results, createdAt: r[9]
        };
    });
}

// --- Password reset helpers (async for compatibility with PostgreSQL) ---
async function createResetToken(email, token, expiresAt) {
    db.run('INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)', [email, token, expiresAt]);
    debouncedSave();
}

async function findValidResetToken(email, token) {
    const row = db.exec(
        "SELECT id FROM password_reset_tokens WHERE email = ? AND token = ? AND used = 0 AND expires_at > datetime('now')",
        [email, token]
    );
    return row[0]?.values[0] ? row[0].values[0][0] : null;
}

async function markTokenUsed(tokenId) {
    db.run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [tokenId]);
    debouncedSave();
}

async function updateUserPassword(email, passwordHash) {
    db.run('UPDATE users SET password_hash = ? WHERE email = ?', [passwordHash, email]);
    debouncedSave();
}

async function updateUserProfile(userId, fields) {
    const allowed = ['name', 'phone', 'location'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
        if (fields[key] !== undefined) {
            updates.push(`${key} = ?`);
            values.push(fields[key]);
        }
    }
    if (updates.length === 0) return false;
    values.push(userId);
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    debouncedSave();
    return true;
}

// --- Auth token helpers (persistent across restarts, async for PostgreSQL compat) ---
async function saveAuthToken(token, userId, expiresAt) {
    // Single session: delete existing tokens for this user before creating new one
    db.run('DELETE FROM auth_tokens WHERE user_id = ?', [userId]);
    db.run('INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, expiresAt]);
    // Save immediately — don't debounce auth tokens, they must survive a restart
    try { save(); } catch (err) { console.error('Auth token save failed:', err.message); }
}

async function findAuthToken(token) {
    const row = db.exec(
        "SELECT user_id FROM auth_tokens WHERE token = ? AND expires_at > datetime('now')",
        [token]
    );
    return row[0]?.values[0] ? row[0].values[0][0] : null;
}

async function deleteAuthToken(token) {
    db.run('DELETE FROM auth_tokens WHERE token = ?', [token]);
    debouncedSave();
}

async function deleteAuthTokensByEmail(email) {
    const row = db.exec('SELECT id FROM users WHERE email = ?', [email]);
    const userId = row[0]?.values[0]?.[0];
    if (userId) {
        db.run('DELETE FROM auth_tokens WHERE user_id = ?', [userId]);
        debouncedSave();
    }
}

async function purgeExpiredAuthTokens() {
    db.run("DELETE FROM auth_tokens WHERE expires_at <= datetime('now')");
    db.run("DELETE FROM password_reset_tokens WHERE used = 1 OR expires_at <= datetime('now')");
    debouncedSave();
}

module.exports = {
    getDb,
    save,
    flushSave,
    createUser,
    findUserByEmail,
    saveDiseaseReport,
    getUserReports,
    saveSoilInquiry,
    getUserSoilInquiries,
    saveCropRecommendation,
    getUserCropRecommendations,
    createResetToken,
    findValidResetToken,
    markTokenUsed,
    updateUserPassword,
    updateUserProfile,
    saveAuthToken,
    findAuthToken,
    deleteAuthToken,
    deleteAuthTokensByEmail,
    purgeExpiredAuthTokens,
};
