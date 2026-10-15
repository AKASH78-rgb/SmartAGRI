const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 5099;
const BASE = `http://localhost:${PORT}`;

let proc;
let authToken;
let tempDbDir;

before(async () => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartagricare-test-'));
    proc = spawn(process.execPath, ['index.js'], {
        cwd: __dirname,
        stdio: 'pipe',
        env: {
            ...process.env,
            PORT: String(PORT),
            DATABASE_TYPE: 'sqlite',
            SMARTAGRICARE_DB_PATH: path.join(tempDbDir, 'smartagricare.db'),
        },
    });

    // Wait for server to start
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 30000);
        proc.stdout.on('data', (data) => {
            if (data.toString().includes('running on port')) {
                clearTimeout(timeout);
                resolve();
            }
        });
        proc.stderr.on('data', (data) => {
            console.error('Server stderr:', data.toString());
        });
    });
});

after(async () => {
    if (proc && proc.exitCode === null) {
        proc.kill();
        await new Promise(resolve => proc.once('exit', resolve));
    }
    if (tempDbDir) fs.rmSync(tempDbDir, { recursive: true, force: true });
});

// ---------- Health ----------

describe('Health check', () => {
    it('GET /api/health returns ok', async () => {
        const res = await fetch(`${BASE}/api/health`);
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.status, 'ok');
        assert.strictEqual(data.service, 'SmartAgriCare Backend');
    });
});

// ---------- Auth ----------

describe('Auth', () => {
    it('POST /api/auth/register with valid data', async () => {
        const res = await fetch(`${BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test User', email: `test${Date.now()}@test.com`, password: 'password123' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 201);
        assert.strictEqual(data.success, true);
        assert.ok(data.user);
        assert.ok(data.token);
    });

    it('POST /api/auth/register rejects short name', async () => {
        const res = await fetch(`${BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'A', email: 'short@test.com', password: 'password123' }),
        });
        assert.strictEqual(res.status, 400);
    });

    it('POST /api/auth/register rejects short password', async () => {
        const res = await fetch(`${BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test', email: 'pw@test.com', password: '123' }),
        });
        assert.strictEqual(res.status, 400);
    });

    it('POST /api/auth/login succeeds after register', async () => {
        // First register
        const email = `login${Date.now()}@test.com`;
        const registerRes = await fetch(`${BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Login User', email, password: 'password123' }),
        });
        const registered = await registerRes.json();

        // Then login
        const res = await fetch(`${BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: 'password123' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.ok(data.user);
        assert.ok(data.token);
        assert.strictEqual(data.user.email, email);
        assert.strictEqual(data.user.id, registered.user.id);
        authToken = data.token; // Save for later tests
    });

    it('POST /api/auth/login rejects missing email', async () => {
        const res = await fetch(`${BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'password123' }),
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
    });

    it('POST /api/auth/login rejects wrong password', async () => {
        const email = `wrong${Date.now()}@test.com`;
        await fetch(`${BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test', email, password: 'password123' }),
        });
        const res = await fetch(`${BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: 'wrongpassword' }),
        });
        assert.strictEqual(res.status, 401);
    });

    it('stores soil inquiries against the authenticated SQLite user', async () => {
        const email = `soil${Date.now()}@test.com`;
        const registerRes = await fetch(`${BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Soil Farmer', email, password: 'password123', phone: '9876543210' }),
        });
        const registered = await registerRes.json();
        assert.strictEqual(registerRes.status, 201);

        const loginRes = await fetch(`${BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: 'password123' }),
        });
        const login = await loginRes.json();
        assert.strictEqual(loginRes.status, 200);
        assert.strictEqual(login.user.id, registered.user.id);
        assert.strictEqual(login.user.phone, '9876543210');

        const inquiryRes = await fetch(`${BASE}/api/soil/inquiry`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${login.token}`,
            },
            body: JSON.stringify({
                name: 'Soil Farmer',
                phone: '9876543210',
                village: 'Kakati',
                district: 'Belagavi',
                landAcres: '2.5',
                crop: 'Sugarcane',
                soilType: 'Black soil',
                notes: 'Need soil testing guidance',
            }),
        });
        const inquiry = await inquiryRes.json();
        assert.strictEqual(inquiryRes.status, 201);
        assert.ok(inquiry.inquiryId);
        assert.ok(fs.statSync(path.join(tempDbDir, 'smartagricare.db')).size > 0);

        const historyRes = await fetch(`${BASE}/api/soil/inquiries`, {
            headers: { Authorization: `Bearer ${login.token}` },
        });
        const history = await historyRes.json();
        assert.strictEqual(historyRes.status, 200);
        assert.strictEqual(history.inquiries.length, 1);
        assert.strictEqual(history.inquiries[0].district, 'Belagavi');
        assert.strictEqual(history.inquiries[0].landAcres, 2.5);

        const unauthenticatedRes = await fetch(`${BASE}/api/soil/inquiries`);
        assert.strictEqual(unauthenticatedRes.status, 401);
    });

    it('POST /api/auth/forgot-password responds for unknown email', async () => {
        const res = await fetch(`${BASE}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'nobody@nowhere.com' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        // Should not reveal whether email exists
    });
});

// ---------- Diseases ----------

describe('Diseases', () => {
    it('GET /api/diseases lists diseases', async () => {
        const res = await fetch(`${BASE}/api/diseases`);
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.ok(Array.isArray(data.diseases));
        assert.ok(data.diseases.length >= 1);
    });

    it('GET /api/diseases/late%20blight finds disease', async () => {
        const res = await fetch(`${BASE}/api/diseases/late%20blight`);
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.disease.name, 'Late Blight');
    });

    it('GET /api/diseases/:name returns 404 for unknown', async () => {
        const res = await fetch(`${BASE}/api/diseases/unknown_disease`);
        assert.strictEqual(res.status, 404);
    });
});

// ---------- Crops ----------

describe('Crops', () => {
    it('POST /api/crops/recommend returns kharif crops', async () => {
        const res = await fetch(`${BASE}/api/crops/recommend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ season: 'kharif' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.ok(Array.isArray(data.crops));
        assert.ok(data.crops.length > 0);
    });

    it('POST /api/crops/recommend requires season', async () => {
        const res = await fetch(`${BASE}/api/crops/recommend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.strictEqual(res.status, 400);
    });

    it('GET /api/crop-meta returns soils and districts', async () => {
        const res = await fetch(`${BASE}/api/crop-meta`);
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.ok(Array.isArray(data.soils));
        assert.ok(Array.isArray(data.districts));
    });

    it('GET /api/crops/paddy finds crop', async () => {
        const res = await fetch(`${BASE}/api/crops/paddy`);
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.ok(data.crop.name.toLowerCase().includes('paddy'));
    });
});

// ---------- Weather ----------

describe('Weather', () => {
    it('GET /api/weather returns weather data', async () => {
        const res = await fetch(`${BASE}/api/weather?lat=15.9&lng=79.7`);
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.ok(data.weather);
        assert.ok('temperature' in data.weather);
        assert.ok('humidity' in data.weather);
        assert.ok('condition' in data.weather);
    });
});

// ---------- Voice ----------

describe('Voice', () => {
    it('POST /api/voice/query returns response', async () => {
        const res = await fetch(`${BASE}/api/voice/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'disease treatment', language: 'en' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.ok(data.response);
    });

    it('POST /api/voice/query handles Hindi', async () => {
        const res = await fetch(`${BASE}/api/voice/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'crop season', language: 'hi' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.language, 'hi');
    });

    it('POST /api/voice/query rejects empty query', async () => {
        const res = await fetch(`${BASE}/api/voice/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: '', language: 'en' }),
        });
        assert.strictEqual(res.status, 400);
    });
});

// ---------- Protected routes (auth required) ----------

describe('Protected routes', () => {
    it('POST /api/disease/report requires auth', async () => {
        const res = await fetch(`${BASE}/api/disease/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disease: 'Late Blight' }),
        });
        assert.strictEqual(res.status, 401);
    });

    it('GET /api/disease/reports requires auth', async () => {
        const res = await fetch(`${BASE}/api/disease/reports`);
        assert.strictEqual(res.status, 401);
    });

    it('PUT /api/auth/profile requires auth', async () => {
        const res = await fetch(`${BASE}/api/auth/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Hacker' }),
        });
        assert.strictEqual(res.status, 401);
    });
});
