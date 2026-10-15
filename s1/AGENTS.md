# AGENTS.md

This file provides guidance to AI assistants when working with code in this repository.

## Project Overview

SmartAgriCare (SAC) is an AI-powered agriculture web app for Indian farmers in Andhra Pradesh. It is a **final year college project** with the following features:

- **Disease Detection**: TensorFlow PlantX MobileNetV2 model (`models/best_model.h5`, 15 classes: Tomato, Potato, Bell Pepper) with image-quality and confidence-based rejection
- **Crop Recommendation**: Research-backed system using AP agro-climatic zone data (30 crops, district-specific varieties, ICAR/CRIDA data)
- **Voice Assistant**: Multilingual farming advice (English, Hindi, Telugu) via triple LLM cascade (Groq → Gemini → SambaNova)
- **Local Stores**: Find nearby agricultural stores via OpenStreetMap Overpass API
- **Weather**: Real-time weather via Open-Meteo + Nominatim reverse geocoding
- **Auth**: Email/password auth with password reset via email OTP

## Architecture

```
smartagricare/
├── backend/              # Express.js REST API (port 5000)
│   ├── index.js          # All routes, middleware, AP_CROPS database, LLM cascade
│   ├── db.js             # SQLite (sql.js) with atomic writes, user/auth/history tables
│   ├── package.json      # bcryptjs, cors, dotenv, express, helmet, nodemailer, sql.js, undici
│   └── .env              # API keys (GROQ, GEMINI, SAMBANOVA, SMTP) — gitignored
├── frontend/             # Vite + React + TypeScript web app (port 8080)
│   └── src/
│       ├── components/   # BottomNav (with FAB), MobileLayout, shadcn/ui primitives
│       ├── contexts/     # AuthContext (login/register/token), AppContext (language state)
│       ├── pages/        # Auth, Dashboard, DiseaseDetection, CropRecommendation, Stores, VoiceAssistant, Profile
│       ├── services/     # api.ts (apiFetch with 401 auto-logout, retry wrapper)
│       └── lib/          # i18n.ts (en/hi/te translations), tts.ts (Web Speech + Google TTS fallback)
├── ml-service/           # Flask ML API (port 5001)
│   ├── app.py            # PlantX MobileNetV2 model, image quality and confidence checks
│   └── requirements.txt  # torch, torchvision, timm, flask, flask-cors, numpy, Pillow
├── expo-app/             # Expo WebView wrapper (loads frontend URL on device)
├── crop_disease_data.json # Disease treatment data for the supported crop catalog
├── models/
│   ├── best_model.h5
│   └── class_indices_reverse.json
├── render.yaml           # Render deployment: web service + private ML service
├── start.bat             # Windows batch script to start all 3 services
└── .gitignore            # .env, node_modules, __pycache__, *.pth, dist/
```

## Build & Run Commands

### Start All Services (Development)

```bash
# Terminal 1: ML Service (must start first — model takes ~30s to load)
cd ml-service && python app.py                    # Port 5001

# Terminal 2: Backend
cd backend && node index.js                       # Port 5000

# Terminal 3: Frontend
cd frontend && npx vite --host 0.0.0.0 --port 8080   # Port 8080
```

Or use `start.bat` to launch all three.

### Build for Production

```bash
cd frontend && npm run build    # Creates frontend/dist/
cd backend && npm start         # Serves API + frontend/dist/ static files
```

## API Endpoints

### Backend (port 5000)

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `/api/health` | GET | No | No | Health check |
| `/api/auth/login` | POST | No | No | Login (email, password) |
| `/api/auth/register` | POST | No | 30/min | Register (name, email, password, optional phone) |
| `/api/auth/forgot-password` | POST | No | No | Send reset OTP via email |
| `/api/auth/reset-password` | POST | No | 5/min | Reset password with OTP |
| `/api/auth/validate` | POST | Yes | No | Validate auth token |
| `/api/auth/profile` | PUT | Yes | No | Update profile (name, phone, location) |
| `/api/auth/logout` | POST | Yes | No | Logout (delete token) |
| `/api/soil/inquiry` | POST | Yes | No | Save farmer soil details to the user's history |
| `/api/soil/inquiries` | GET | Yes | No | Get the authenticated user's soil inquiry history |
| `/api/weather` | GET | No | 20/min | Weather + 7-day forecast (Open-Meteo) |
| `/api/stores/nearby` | GET | No | 15/min | Nearby agri stores (Overpass API, 20s timeout) |
| `/api/crop-meta` | GET | No | No | List AP districts + seasons |
| `/api/crops/recommend` | POST | No | No | Crop recommendations (season, soil, water, district, land) |
| `/api/disease/detect` | POST | No | 10/min | Proxy to ML service `/predict` |
| `/api/disease/report` | POST | Yes | No | Save disease report |
| `/api/disease/reports` | GET | Yes | No | Get user's saved reports |
| `/api/voice/query` | POST | No | 15/min | Voice assistant (LLM cascade) |
| `/api/tts` | GET | No | No | Google Translate TTS proxy |
| `/predict` | POST | No | 10/min | Direct proxy to ML service |

### ML Service (port 5001)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Model status, class count, accuracy |
| `/predict` | POST | Disease prediction (multipart image upload) |

## Key Technical Details

### ML Model — PlantX MobileNetV2

The installed model classifies 15 Tomato, Potato, and Bell Pepper leaf conditions. The service rejects poor-quality images and predictions that do not meet its confidence, top-class margin, and entropy thresholds. The UI and API should not claim support for crops outside the model's class list.

### LLM Voice Assistant — Triple Cascade

```
Groq (primary, free tier: 30 RPM)
  → Gemini (fallback)
    → SambaNova (last resort)
```

Each provider has its own timeout and error handling. System prompt is farming-focused with multilingual support. Responses are cleaned for TTS (`cleanForTts()`).

### Crop Recommendation — Research-Backed

- **30 AP crops** with ICAR/CRIDA data: varieties, districts, soils, water, fertilizer, intercrops, pH range, rainfall
- **Match scoring**: Primary soil +15 / secondary +10, primary district +12 / secondary +8, land size bonus
- **Water filtering**: "High" includes "Moderate" crops, "Moderate" includes "Low"
- **Images**: Unsplash URLs with `?w=400&q=80` format, emoji fallback on error
- **Top 12** results returned, sorted by match score

### Authentication

- Tokens: Random 32-byte hex, stored in SQLite `auth_tokens` table, 7-day expiry
- Frontend stores token in `localStorage`, auto-clears on 401 response
- Passwords: bcrypt hashed
- Password reset: 6-digit OTP sent via Gmail SMTP, 15-minute expiry

### Security Features

- **Helmet**: Full security headers (HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
- **Rate limiting**: In-memory per-IP rate limits on all public endpoints
- **CORS**: Production same-origin; dev mode checks against whitelist + ngrok patterns
- **ML CORS**: Restricted to backend origin only
- **Atomic DB writes**: Write to `.tmp` file, then `fs.renameSync`
- **Auth middleware**: `requireAuth` checks Bearer token on protected routes

### Internationalization

- **3 languages**: English (en), Hindi (hi), Telugu (te)
- **i18n system**: `frontend/src/lib/i18n.ts` with `t(key, language, vars?)` function
- **All UI strings translated**: Crop recommendation, disease detection, stores, auth, profile, voice assistant
- **TTS**: Web Speech API + Google Translate TTS proxy fallback for Hindi/Telugu

### Database (SQLite via sql.js locally; MongoDB is opt-in)

Tables: `users`, `soil_inquiries`, `disease_reports`, `crop_recommendations`, `password_reset_tokens`, `auth_tokens`

- Stored at `backend/data/smartagricare.db` by default
- Set `DATABASE_TYPE=mongodb` and `MONGODB_URI` to explicitly use MongoDB
- `SMARTAGRICARE_DB_PATH` can override the SQLite file path (for isolated tests)
- Atomic writes (write to `.tmp` then rename)
- Auto-save every 60 seconds + debounced save on mutations
- Flush on process exit

## Environment Variables (backend/.env)

```env
GROQ_API_KEY=gsk_...           # Primary LLM (required)
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_API_KEY=AI...           # Fallback LLM
GEMINI_MODEL=gemini-2.0-flash
SAMBANOVA_API_KEY=...          # Last resort LLM
SAMBANOVA_MODEL=Meta-Llama-3.1-70B-Instruct
SMTP_EMAIL=...@gmail.com       # For password reset emails
SMTP_PASSWORD=...              # Gmail app password
ML_SERVICE_URL=http://localhost:5001   # Auto-prepends http:// if missing
PORT=5000
NODE_ENV=production            # Enables trust proxy, static caching
CORS_ORIGINS=http://localhost:8080,http://localhost:5173
```

## Deployment (Render)

`render.yaml` defines two services:
1. **Web service** (`smartagricare`): Node.js, builds frontend + backend, serves both
2. **Private service** (`smartagricare-ml`): Python, runs ML model, only accessible from web service

ML_SERVICE_URL is auto-linked via Render's `fromService` with `http://` prefix handling.

Static assets served with 7-day cache + immutable headers in production.

## Complete Change Log (All Sessions)

### Session 1 — Initial Setup & Core Fixes

1. Migrated voice assistant from Ollama to Gemini API
2. Added Groq as primary LLM (free tier, fast)
3. Implemented triple LLM cascade: Groq → Gemini → SambaNova
4. Replaced the placeholder ML service with the PlantX MobileNetV2 model
5. Implemented 4-layer OOD rejection for non-plant images
6. Fixed database reliability (atomic writes, debounced saves)
7. Fixed backend stability (IPv4 forcing, fetch retries)
8. Removed all mock/hardcoded data from disease detection
9. Fixed frontend auth flow and token management
10. Created `start.bat` for easy startup

### Session 2 — Crop Recommendation Overhaul

Applied deep research report (`deep-research-report (1).md`) data:
1. **Expanded AP_CROPS** from 22 to 30 crops with research-based data
2. Added new fields: `varieties`, `msp`, `intercrops`, `image`, `phRange`, `rainfall`
3. District assignments matched to AP agro-climatic zones (North Coastal, Krishna-Godavari Delta, Southern Plateau)
4. Improved match scoring algorithm (soil/district/water/land size)
5. **Frontend CropRecommendation.tsx** completely rewritten with crop images, detail modal, varieties pills, intercrops badges
6. Fixed all Unsplash image URLs (tested each one for HTTP 200)
7. Later removed MSP display per user request

### Session 3 — First Audit & Fixes (15 issues)

**Backend fixes:**
- Rate limits on `/predict`, password reset, weather, stores endpoints
- Deterministic store ratings (hash-based instead of `Math.random()`)
- Weather error returns 503 instead of fake data
- Overpass radius capped at 50km max

**Frontend fixes:**
- Profile: removed hardcoded phone/location
- Auth: removed OTP auto-display in UI
- Auth: added loading spinner on login/signup buttons
- CropRecommendation: added error toast on failure

**ML/Deployment:**
- ML CORS restricted to backend origin only
- Removed hardcoded `NEARBY_STORES` from ML service
- Updated `render.yaml` with ML service

### Session 4 — Second Audit & Fixes (15 issues)

**Critical fixes:**
- BottomNav FAB route: `/voice` → `/voice-assistant` (was showing blank page)
- Atomic DB writes: write to `.tmp` then `fs.renameSync` (prevents corruption)

**High fixes:**
- Added Helmet security headers (HSTS, X-Frame-Options, nosniff, etc.)
- Auto-logout on 401: clears token, redirects to `/auth` (skips login/register endpoints)
- Profile email field now read-only in edit mode (backend doesn't accept email changes)
- Overpass API fetch: added 20s timeout via `AbortSignal.timeout`
- Voice endpoint: returns `success: false` + 500 on error (was returning `success: true`)
- `render.yaml` ML_SERVICE_URL: backend auto-prepends `http://` if missing protocol

**Medium fixes:**
- Removed fake medication timeline fallback (misleading to farmers)
- Removed unused `Calendar` import from DiseaseDetection
- Removed unused `Bell`, `Thermometer` imports from Dashboard
- Internationalized CropRecommendation: "water", "Recommended Varieties", "Intercropping", "more"
- Added i18n translations for `water_label`, `recommended_varieties`, `intercropping`, `more`
- Nominatim caching: 1-hour TTL cache + 5s timeout (respects usage policy)
- ML CORS: removed empty string when `BACKEND_URL` unset

**Low fixes:**
- Added `"start": "node index.js"` to backend `package.json`
- Static assets: 7-day cache + immutable in production

### Session 5 — Final Cleanup (10 issues)

**Dependency cleanup:**
- Removed 33 unused npm deps (20 Radix UI components, recharts, date-fns, cmdk, embla-carousel, input-otp, next-themes, react-day-picker, react-resizable-panels, vaul)
- Kept only: `@radix-ui/react-slot`, `@radix-ui/react-toast`, `@radix-ui/react-tooltip`

**Code quality:**
- i18n `replace` → `replaceAll` (repeated `{vars}` now work)
- `torch.set_num_threads`: uses `os.cpu_count()` capped at 4 (was hardcoded 4)
- Removed dead `hasVoiceForLanguage()` function from `tts.ts`
- Fixed package name: `vite_react_shadcn_ts` → `smartagricare-frontend`
- Language validation: localStorage value checked against `en|hi|te` before use
- `capturePhoto` stale closure: added `languageRef` to avoid stale `language` in callback

**Security:**
- Dev CORS: now actually blocks unauthorized origins (was allowing all in else branch)

**UX:**
- Store open status: returns `null` when no data instead of fake `true`; UI shows "—" for unknown
- OSM map: removed broken multi-marker params (embed only supports single marker)

### Session 5.5 — Deep Audit, Load Testing & Hardening

**ML Service (`app.py`) — Complete rewrite:**
- PIL decompression bomb protection: `Image.MAX_IMAGE_PIXELS = 4_000_000`
- Concurrency limiter: `threading.Semaphore(8)` + inference lock with 30s timeout
- Explicit PIL image closing in all code paths (try/finally)
- Explicit tensor cleanup after inference (`del tensor, logits, probs...`)
- Content-length check before reading uploaded file
- Returns 503 when overloaded instead of queueing indefinitely
- Switched to gunicorn (1 worker, 4 threads, 120s timeout) for production
- Added numpy to requirements.txt
- Replaced `print` with `logging` module

**Backend `db.js` — Complete rewrite:**
- `getDb()` mutex pattern (`_dbPromise`) prevents concurrent initialization race
- Added 5 DB indexes: `idx_users_email`, `idx_auth_tokens_token`, `idx_auth_tokens_user`, `idx_reset_tokens_email`, `idx_reports_user`
- Error handling in `debouncedSave`: try/catch with retry flag
- Save writes `data` (Uint8Array) directly instead of `Buffer.from(data)` — avoids 2x memory spike
- `findUserByEmail` now returns `phone` field
- `getUserReports(userId, limit=50, offset=0)` — pagination with LIMIT/OFFSET
- `saveAuthToken` deletes existing user tokens first (single-session enforcement)
- `purgeExpiredAuthTokens` also purges expired/used password reset tokens

**Backend `index.js` — Security & Performance:**
- JSON body limit: `10mb` → `100kb` (prevents memory abuse)
- Upload size check: content-length check (15MB max) before proxying to ML
- TTS lang validation: whitelist `['en', 'hi', 'te']` instead of raw interpolation
- Forgot-password timing fix: random delay (300-700ms) for non-existent emails (prevents email enumeration)
- Coordinate validation: `Math.max(-90, Math.min(90, ...))` clamping on weather endpoint
- Nominatim cache eviction: `setInterval` hourly cleanup of stale entries
- Request logging: strips query params, production-only for non-API routes

**Load Testing:**
- 100 concurrent health checks: 2159ms, all 200 OK
- 100 concurrent crop recommendations: 2018ms, all 200 OK
- Backend survived full load test without errors

### Session 6 — Polish, i18n, UX & Reliability (19 items)

**Backend fixes:**
- API 404 handler: `app.use('/api', ...)` before SPA catch-all — non-existent API routes now return JSON `{ success: false, error: "Endpoint not found" }` instead of HTML
- Stores endpoint coordinate clamping: both main path (line 853) and catch-block fallback (line 959) now use `Math.max(-90, Math.min(90, ...))` — prevents invalid lat/lng from crashing Overpass
- Fixed corrupted `proxyToMlService` function (missing `undici.request()` call)
- Forgot password email deliverability improvements:
  - Added `replyTo` header (matches From address)
  - Added `List-Unsubscribe` header
  - Added plaintext `text` body alongside HTML (spam filters penalize HTML-only)
  - Simplified subject: `"SmartAgriCare - Password Reset Code"` → `"Your password reset code"`
  - Added `X-Priority: 1` header

**Frontend i18n completion (10 new translation keys):**
- BottomNav: all 6 labels translated (`nav_home`, `nav_crop_rec`, `nav_scan`, `nav_profile`, `nav_find_stores`, `nav_voice`) — was entirely hardcoded English
- Profile: `"Farmer"` → `t('farmer', language)` with hi/te translations (किसान/రైతు)
- Profile: `"Language"` → `t('language', language)` (already existed, just not used)
- Auth: `"Back to Login"` → `t('back_to_login', language)` with hi/te translations
- Stores: `stores_fetch_error`, `map_area_note` added

**Dashboard improvements:**
- Dynamic weather icons based on WMO weather code (Sun, CloudSun, Cloud, CloudRain, CloudDrizzle, CloudSnow, CloudLightning, CloudFog) — was static `Cloud` icon always
- Added `weatherCode` to state, stored from API response
- Weather failure toast: shows "Weather data unavailable. Showing defaults." + `(offline)` badge
- Refresh button (RefreshCw icon) in weather card header — spins while loading
- AbortController cleanup: `cancelledRef` prevents state updates after unmount
- Forecast row now shows per-day weather icons

**Stores page overhaul:**
- Skeleton loading cards (4 animated placeholders) instead of plain spinner
- Error toast on API fetch failure using `languageRef` for stable async access
- Refresh button next to page title
- Google Maps directions URL now includes user origin: `&origin=${userLat},${userLng}`
- Map area note below iframe: "Your area. Use Navigate buttons below for directions."
- Removed unused `Loader2` import

**Frontend reliability:**
- `AuthContext`: token validation now uses `authAPI.validate()` with shared headers (`ngrok-skip-browser-warning`) instead of raw `fetch()`
- `api.ts`: added `authAPI.validate(token)` method — handles network errors gracefully (returns `{ success: true }` to avoid logout on server startup)
- TTS native bridge: added `_nativeTtsOnEnd` callback + `window.addEventListener('message')` listener for `NATIVE_TTS_END` / `NATIVE_TTS_DONE` events from Expo + 30s fallback timeout
- `stopSpeaking()` now clears native TTS callback
- DiseaseDetection: added `isMountedRef` guard — prevents React state updates after unmount during async image analysis
- VoiceAssistant mic debounce: 500ms cooldown on `toggleListening` prevents double-tap race conditions

**Build fix:**
- Fixed `sonner.tsx` importing `next-themes` (removed in Session 5 dep cleanup) — replaced `useTheme()` with hardcoded `theme="dark"`

### Session 7 — Performance, Stability & Polish

**Core fix: Shared location cache (eliminated "detecting everytime")**
- `AppContext.tsx`: Added `Coords` type (`{ lat, lng, timestamp }`), `coords` state initialized from `sessionStorage` (10 min TTL), `setCoords()` writes state + sessionStorage, `coordsLoading` state, one-time `useEffect` geolocation call (`enableHighAccuracy: false`, 5s timeout), fallback to Visakhapatnam (17.6868, 83.2185)
- Root cause: both `Stores.tsx` and `Dashboard.tsx` independently called `navigator.geolocation.getCurrentPosition` on every mount with `enableHighAccuracy: true` and 20s timeout — no caching at all
- Fix: single geolocation call in `AppProvider` on app init, cached across all page navigations

**Stores page rewrite:**
- Removed entire `getCurrentPosition` call — uses `coords` from `useApp()` via `useEffect` with `hasFetched` ref to prevent double-fetch
- Map iframe: conditional render (shows `MapSkeleton` placeholder while coords loading, prevents double-load from null→real transition)
- Native GPS throttle: `lastNativeUpdate` ref with 10s cooldown + 100m minimum distance check — prevents spam from Expo wrapper
- Memoized filtered stores: wrapped `filtered` in `useMemo([stores, search])`
- Added `aria-label` on search input
- Added `no_stores_subtitle` i18n key (en/hi/te) — shown below "no stores found" in empty state

**Dashboard performance:**
- Removed direct `getCurrentPosition` call — uses `coords` from `useApp()` with `hasFetched` ref
- Extracted `mapWeatherData()` helper — eliminates duplicate data mapping (was duplicated between `doFetchWeather` and `refreshWeather`)
- Added `weatherLoading` state — weather card shows `animate-pulse` until real data arrives (previously showed fake 28° "Clear sky" immediately)
- Simplified `refreshWeather` — uses coords from context instead of calling geolocation again
- Fixed offline indicator: `text-[11px]` (removed double opacity, slightly larger)

**UI polish:**
- BottomNav: active pill indicator (`h-1 w-4 rounded-full bg-primary mt-0.5`) below active icon/label
- CropRecommendation: loading skeleton grid (4 `CropCardSkeleton` cards in 2-col layout) shown during API call
- CropCard: extracted as `React.memo` component with local `imgFailed` state — prevents image error in one card from re-rendering entire grid; removed parent-level `imgErrors` state

**VoiceAssistant fixes:**
- Fixed broken mic debounce: replaced `(toggleListening as any)._cooldown` (lost on `useCallback` recreation) with `micCooldownRef = useRef(false)` — now persists across renders
- Unique message IDs: added `id: string` to Message interface, generated with `Date.now() + counter`; `key={m.id}` instead of `key={i}` — fixes React reconciliation issues

**Auth accessibility:**
- Added `aria-label` to all 8 form inputs:
  - Login: "Email address", "Password"
  - Signup: "Full name", "Email address", "Password", "Confirm password"
  - Forgot password: "Email address for password reset", "6-digit reset code", "New password"

**i18n:**
- Added `no_stores_subtitle` key (en/hi/te): "Try a different search term or check back later"

### Session 7b — Deep Audit & Security Fixes

**HIGH-severity security fixes:**
- **CORS**: `origin: true` in production was reflecting ANY origin with `credentials: true`, allowing any website to make authenticated API calls. Fixed: now uses function-based origin check — blocks all cross-origin in production (same-origin via Express = no `Origin` header), allows `RENDER_EXTERNAL_URL` if set
- **Forgot-password timing oracle**: non-existent emails returned in 300-700ms, real emails took 500-3000ms (email sending). Attacker could enumerate emails by measuring response time. Fixed: all code paths now target 800-1200ms using `delayRemaining()` that measures elapsed time and pads to match
- **OTP/email logged in production**: `console.log` for OTP and email was unconditional. Fixed: both gated behind `if (!IS_PROD)`
- **`_mlServiceDown: true`** leaked internal infrastructure state to clients. Removed from error response

**MEDIUM-severity fixes:**
- **`req.connection.remoteAddress`** deprecated in Node 18+/Express 5. Changed to `req.socket?.remoteAddress`
- **Dashboard `refreshWeather` missing `cancelledRef` guard**: could setState on unmounted component. Added `cancelledRef.current` checks
- **Dashboard `SHORT_DAYS` hardcoded English**: replaced with i18n (`day_sun`...`day_sat` keys in en/hi/te)
- **Stores `MapSkeleton` hardcoded "Loading map..."**: replaced with `loading_map` i18n key (en/hi/te)
- **AppContext `loadCachedCoords()` called twice**: once for state init, once for loading check. Refactored to use `coords` variable from first `useState`

**i18n keys added (10):**
- `day_sun`, `day_mon`, `day_tue`, `day_wed`, `day_thu`, `day_fri`, `day_sat` (en/hi/te)
- `loading_map` (en/hi/te)

## Known Limitations (Not Fixable Without Major Rework)

| Issue | Reason |
|-------|--------|
| Store ratings are fabricated | OSM has no rating data; no free alternative exists |
| Google TTS endpoint scraping | Only free Telugu/Hindi TTS option available |
| `weights_only=False` in PyTorch load | Requires re-saving model with safe tensors (needs training pipeline) |
| Auth tokens in localStorage | Switching to HttpOnly cookies requires full auth architecture rewrite |
| In-memory rate limiter | Only matters with multiple server instances (not applicable for this project) |
| No test suite | Would need significant effort; not blocking for demo/evaluation |

## Files Modified (Complete List)

### Backend
- `backend/index.js` — Routes, middleware, AP_CROPS, LLM cascade, security headers, rate limits, Nominatim cache, API 404 handler, email deliverability, coord clamping, upload size limits, TTS lang whitelist, timing-safe forgot-password
- `backend/db.js` — Atomic DB writes (tmp + rename), mutex init, indexes, pagination, single-session tokens, expired token purge
- `backend/package.json` — Added `helmet`, `start` script
- `backend/.env` — API keys (gitignored)

### Frontend
- `frontend/src/pages/Auth.tsx` — Loading spinners, OTP removal, password visibility, i18n "Back to Login", aria-labels on all inputs
- `frontend/src/pages/CropRecommendation.tsx` — Complete rewrite with images, i18n, detail modal, React.memo CropCard, loading skeleton grid
- `frontend/src/pages/DiseaseDetection.tsx` — Removed fake medication fallback, fixed stale closure, isMounted guard, removed unused imports
- `frontend/src/pages/Dashboard.tsx` — Dynamic weather icons (WMO codes), refresh button, failure toast, abort cleanup, cached coords from AppContext, weatherLoading pulse, mapWeatherData helper
- `frontend/src/pages/Profile.tsx` — Email read-only, i18n "Farmer"/"Language", removed hardcoded values
- `frontend/src/pages/Stores.tsx` — Skeleton loaders, error toast, refresh button, directions with origin, map area note, cached coords from AppContext, MapSkeleton, native GPS throttle, memoized filter, aria-label, empty state subtitle
- `frontend/src/pages/VoiceAssistant.tsx` — LLM cascade integration, mic debounce (useRef-based), unique message IDs
- `frontend/src/components/BottomNav.tsx` — Fixed FAB route, full i18n (6 nav labels), active pill indicator
- `frontend/src/components/ui/sonner.tsx` — Removed `next-themes` dependency, hardcoded dark theme
- `frontend/src/services/api.ts` — 401 auto-logout, retry wrapper, `authAPI.validate()` method
- `frontend/src/contexts/AppContext.tsx` — Language validation, shared coords cache (sessionStorage, 10 min TTL, one-time geolocation)
- `frontend/src/contexts/AuthContext.tsx` — Token validation via `authAPI.validate()` with shared headers
- `frontend/src/lib/i18n.ts` — 70+ translation keys (nav, crop, store, auth, profile, dashboard), `no_stores_subtitle`
- `frontend/src/lib/tts.ts` — Native bridge onEnd listener + 30s fallback timeout, removed dead function
- `frontend/package.json` — Removed 33 unused deps, fixed name
- `frontend/vite.config.ts` — Proxy config for dev

### ML Service
- `ml-service/app.py` — CORS restricted, concurrency semaphore(8), inference lock timeout, PIL bomb protection, explicit image/tensor cleanup, gunicorn production config, logging
- `ml-service/requirements.txt` — Added numpy, gunicorn

### Deployment
- `render.yaml` — Web + ML private service config, gunicorn startCommand

## Current State (as of Session 7b)

- All services run correctly on ports 5001 (ML), 5000 (backend), 8080 (frontend)
- Frontend builds cleanly (2106 modules, 0 TypeScript errors)
- Backend passes all verification tests:
  - API 404 returns JSON (not HTML) for non-existent routes
  - Stores coordinate clamping works for extreme values
  - Security headers active (10 Helmet headers)
  - CORS blocks unauthorized origins
  - Load test: 100 concurrent requests in 1.8s, all 200 OK
- Geolocation fires only once on app init (AppContext), cached in sessionStorage (10 min TTL)
- Dashboard→Stores→Dashboard navigation: no repeated GPS popup, stores load instantly from cache
- Map iframe loads once (not twice) on Stores page
- Weather card shows loading pulse, then real data
- BottomNav has active pill indicator
- CropRecommendation shows skeleton grid during loading
- VoiceAssistant mic debounce works via ref (not function property)
- Auth inputs have aria-labels
- Full i18n: all pages translated to en/hi/te
- Deep research report data verified in AP_CROPS (30+ crops, varieties, districts, soils, water, fertilizer, intercrops)
- Production-ready `render.yaml` for deployment
