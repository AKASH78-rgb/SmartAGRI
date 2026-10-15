# Implementation Plan — SmartAgriCare Bug Fixes

## Diagnosis Summary (verified against code)

### Issue 1 — Auth page auto-refreshes
**Confirmed root cause.** `Loading.tsx` unconditionally navigates to `/language` after 2.2 s (line: `navigate("/language", { replace: true })`). `Language.tsx`'s `handleContinue` always calls `navigate("/auth")` regardless of authentication state — it reads nothing from `AuthContext`. `Auth.tsx` has no "already logged in → redirect to /dashboard" guard. Additionally `api.ts` line 30 does `window.location.href = '/auth'` on any 401 response, causing hard full-page reloads mid-session instead of a soft React Router navigation.

The combination creates a loop for logged-in users: `/` → Loading (2.2 s) → `/language` → Continue → `/auth`, and every 401 API error triggers a hard reload back to `/auth`.

### Issue 2 — Disease detection not working / accepts fake images
**Confirmed:** The ML service at `ml-service/app.py` is a **working Flask API on port 5001** that already serves `POST /predict` using `models/best_model.h5` (the MobileNetV2 PlantX model, 15 classes). The backend `index.js` proxies to it correctly. The `d_disease/app.py` is a Streamlit app for the TFLite model — it is NOT used by the backend.

The real problem is that `models/best_model.h5` and `models/class_indices_reverse.json` already exist (confirmed in `models/` directory), so the ML service CAN load them. The OOD (out-of-distribution) detection for fake/non-plant images is already implemented in `ml-service/app.py` using three layers: blur/darkness rejection, confidence threshold (0.70), and confidence gap + entropy thresholds. The service already returns `{"success": false, "status": "unrecognized", ...}` for non-plant images.

**The real fix needed:** The `ml-service` is not running (it must be started separately). There is no startup script that launches it alongside the backend. The `d_disease` directory has its own `.venv` but `ml-service` does NOT have a startup helper. We need to:
1. Ensure `ml-service/requirements.txt` is complete and a startup script exists.
2. Add a `start.bat` / startup instructions update so both backend and ML service start together.
3. Optionally lower the OOD confidence threshold from 0.70 to 0.55 as specified, since the current threshold may be too strict, causing valid plant images to be rejected as "unrecognized". The prompt specifies 0.55; the current code uses 0.70. We'll align to 0.55 per spec.

### Issue 3 — Login/signup not saved to SQLite
**Partially confirmed, but root cause differs from hypothesis.** `backend/index.js` calls `await getDb()` in the `start()` function **before** `app.listen()` — so the DB is initialized at startup before any route handler runs. The `data/` directory exists and `smartagricare.db` is present. The `db.js` module-level `db` variable IS set by the time any request arrives.

**Actual problem:** `db.js` functions like `createUser()` are declared as `async` but call `db.run(...)` directly on the module-level `db` variable without calling `await getDb()` first inside each function. If somehow `getDb()` is not awaited at startup (e.g. error path, or the module is `require()`-d before `start()` runs), `db` will be `null` and crash. More importantly, if the backend is started without properly awaiting the `start()` function, `db` could still be null at first request.

The defensive fix: each exported DB function should call `await getDb()` internally rather than assuming `db` is set. This makes each function self-contained. We'll add `const db = await getDb();` at the top of `createUser`, `findUserByEmail`, `saveAuthToken`, and `findAuthToken` (the auth-critical path functions).

Additionally, we need to verify the backend is actually started correctly from `start.bat`.

---

## Implementation Plan

- [ ] 1. **Fix Language.tsx — check auth before navigating to /auth**

      `Language.tsx`'s `handleContinue` unconditionally navigates to `/auth`. Add `useAuth` import and check `isAuthenticated`: if already logged in, navigate to `/dashboard` instead.

      Files: `frontend/src/pages/Language.tsx`

      Change: import `useAuth` from `@/contexts/AuthContext`. In `handleContinue`, add:
      ```ts
      const { isAuthenticated } = useAuth();
      const handleContinue = () => {
        setLanguage(selected);
        navigate(isAuthenticated ? "/dashboard" : "/auth");
      };
      ```

      Verify: Start frontend dev server (`cd frontend && npm run dev`). Navigate to `/language` while logged in (token in localStorage) — clicking Continue should go to `/dashboard`, not `/auth`.

- [ ] 2. **Fix Auth.tsx — redirect already-authenticated users to /dashboard**

      `Auth.tsx` has no guard for already-authenticated users. Add a `useEffect` (or early `Navigate` return) so that if `isAuthenticated && !isValidating`, it redirects to `/dashboard`.

      Files: `frontend/src/pages/Auth.tsx`

      Change: Add near the top of the `Auth` component body:
      ```tsx
      const { isAuthenticated, isValidating } = useAuth();
      // Already logged in — skip auth page
      if (!isValidating && isAuthenticated) {
        return <Navigate to="/dashboard" replace />;
      }
      ```
      Also add `Navigate` to the import from `react-router-dom`.

      Verify: With a valid token in localStorage, navigate to `http://localhost:5174/auth` — it should immediately redirect to `/dashboard` without rendering the login form.

- [ ] 3. **Fix api.ts — replace hard reload with soft navigation on 401**

      `api.ts` line 30 does `window.location.href = '/auth'` which causes a full page reload mid-session. Replace with a `CustomEvent` dispatch so the React app handles it cleanly, or remove the hard redirect entirely (ProtectedRoute already redirects to `/auth` when token is invalid).

      Files: `frontend/src/services/api.ts`

      Change: Replace the 401 handler block:
      ```ts
      // BEFORE (line 28-31):
      if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/register')) {
          localStorage.removeItem('smartagricare_token');
          localStorage.removeItem('smartagricare_user');
          window.location.href = '/auth';
      }
      // AFTER — remove localStorage items but let React Router handle the redirect:
      if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/register')) {
          localStorage.removeItem('smartagricare_token');
          localStorage.removeItem('smartagricare_user');
          // Dispatch a custom event; AuthContext listens and clears state.
          // ProtectedRoute will then redirect to /auth without a hard reload.
          window.dispatchEvent(new CustomEvent('auth:logout'));
      }
      ```
      Then in `AuthContext.tsx`, add a `useEffect` that listens for `'auth:logout'` and calls `setUser(null)`.

      Files: `frontend/src/services/api.ts`, `frontend/src/contexts/AuthContext.tsx`

      Verify: Manually expire/remove the token, make an authenticated API call — the app should soft-navigate to `/auth` without a full page reload (URL bar changes without browser flash).

- [ ] 4. **Fix ml-service — lower OOD confidence threshold to 0.55 and add `medication_timeline`/`max_sprays`/`is_viral` fields**

      The ml-service `CONFIDENCE_THRESHOLD` is 0.70 — too strict, causing real plant images to be flagged as "unrecognized". Lower it to 0.55 per spec. The backend's `detectAndEnrichHandler` expects fields `medication_timeline`, `max_sprays`, `is_viral`, `viral_note` in the ML response — the `ml-service/app.py` does not currently return these. Add them as empty defaults to avoid key errors downstream.

      Files: `ml-service/app.py`

      Changes:
      1. Line `CONFIDENCE_THRESHOLD = 0.70` → `CONFIDENCE_THRESHOLD = 0.55`
      2. In the `diseased` response jsonify call, add:
         ```python
         'medication_timeline': (info.get('medication_timeline', []) if info else []),
         'max_sprays': (info.get('max_sprays', '') if info else ''),
         'is_viral': (info.get('is_viral', False) if info else False),
         'viral_note': (info.get('viral_note', '') if info else ''),
         'stores': [],
         ```
      3. In the `unrecognized` response, add same empty fields for consistency.

      Verify: Start the ml-service (`cd ml-service && python app.py` or using its `.venv`). `GET http://localhost:5001/health` should return `{"model_ready": true, "classes": 15}`. `POST http://localhost:5001/predict` with a clear tomato leaf photo should return `{"success": true, "status": "diseased"|"healthy", ...}` with confidence above 0.55.

- [ ] 5. **Fix db.js — make auth-critical DB functions self-healing with internal getDb() call**

      `createUser`, `findUserByEmail`, `saveAuthToken`, and `findAuthToken` use the module-level `db` variable directly. Add `const db = await getDb();` as the first line of each function so they never fail with "Cannot read properties of null" if `start()` was not awaited first. This also makes each function safe to call from tests or scripts independently.

      Files: `backend/db.js`

      Changes — add `const db = await getDb();` as the first statement inside:
      - `createUser` (currently line ~163)
      - `findUserByEmail` (currently line ~169)
      - `saveAuthToken` (currently line ~252)
      - `findAuthToken` (currently line ~259)

      Note: `getDb()` returns the existing `db` immediately if already initialized (it checks `if (db) return db;`), so the overhead is negligible for the hot path.

      Verify: Restart the backend (`cd backend && node index.js`). Register a new user via `POST http://localhost:5000/api/auth/register` with name/email/password. Log in via `POST http://localhost:5000/api/auth/login`. Check `backend/data/smartagricare.db` exists and is non-zero bytes. Query the DB directly to confirm the user row was inserted: `sqlite3 backend/data/smartagricare.db "SELECT id, name, email FROM users;"`.

- [ ] 6. **Create/update startup script so backend + ML service both start together**

      There is a `start.bat` in the project root but it may not start the ml-service. Update it to start both the Node.js backend and the Python ML service. The ml-service uses a `.venv` in `ml-service/.venv`.

      Files: `start.bat` (update existing)

      Change: Add a line to start `ml-service/app.py` using the ml-service `.venv` Python, in a new window (Windows) or background process. The backend already starts on port 5000 and the ml-service on port 5001.

      Verify: Run `start.bat`. Both processes should start. `curl http://localhost:5000/api/health` → `{"status":"ok"}`. `curl http://localhost:5001/health` → `{"model_ready":true}`.

---

## Verification Steps (end-to-end)

After all items are complete:

1. **Auth loop fixed**: Open `http://localhost:5174` in a fresh browser tab (no localStorage token) → Loading splash → Language selection → `/auth`. Log in. Navigate to `http://localhost:5174/auth` — should redirect to `/dashboard` immediately.

2. **No hard reload on 401**: Open DevTools Network tab. Let session expire (clear token from localStorage DevTools → Application tab). Make an API call from the app. The page should soft-navigate to `/auth` with no full-page reload (no network waterfall restart in DevTools).

3. **Disease detection with real leaf**: Go to Disease Detection, upload a clear tomato leaf photo. Should get a real disease/healthy result.

4. **Disease detection with fake image**: Upload a non-plant photo (e.g., a car or selfie). Should get a user-friendly "unrecognized plant" error message — NOT a crash or 500 error.

5. **Login/signup saved to DB**: Register a new user. Stop the backend. Check `backend/data/smartagricare.db` size is non-zero and the row is present. Restart backend. Log in with the same credentials — should succeed (confirms data persisted).
