# Auth loop fix, disease detection gating, and SQLite startup

Three issues were addressed: the `/auth` page was auto-refreshing when `AuthContext` finished its startup token validation; the disease detection endpoint had no guard against non-plant photos; and the backend DB was queried to verify it was already initialized before `app.listen()`. The frontend changes add `isValidating`-aware redirect guards to both `Language.tsx` and `Auth.tsx`. The Flask API is a new file that wraps the existing TFLite model behind a confidence threshold. The backend startup sequence needed no code change.

Watch for: (confirmed) the `Auth.tsx` redirect effect has a potential race window where a logged-in user briefly renders the auth form before the effect fires; (confirmed) the Flask `/predict` endpoint returns HTTP 200 for low-confidence rejections, which means the frontend must inspect the `status` field rather than the HTTP status code — a contract that is easy to break silently; (possible) `AuthContext` keeps the user logged in on network error during startup validation, which means a revoked token is invisible to the app until the next successful server round-trip.

**Verdict**: APPROVED

---

## High-level view

The auto-refresh fix works by guarding both entry-point pages (`Language` and `Auth`) with a `useEffect` that waits for `isValidating` to settle before redirecting. Without the guard, `AuthContext`'s initial `isValidating: true → false` transition was landing on `/auth` and triggering a re-render loop. The dependency arrays in both effects include all referenced values (`isAuthenticated`, `isValidating`, `navigate`), so there is no stale-closure risk.

The confidence threshold in the Flask API (0.55) gates out non-plant photos by treating any prediction below that score as unrecognized. The implementation uses HTTP 200 for the rejection response with a `status: unrecognized` body field, a deliberate choice so the backend proxy forwards it rather than treating it as an error. That contract is undocumented anywhere except the comment in the code; if the frontend or backend proxy changes its check from the `status` field to the HTTP status code, the gating silently disappears.

The SQLite startup ordering was already correct before this change. The implementation note confirms no code change was made; the reviewer question is satisfied by the confirmed presence of `await getDb()` before `app.listen()` in the `start()` function.

---

<details>
<summary>Issues (3)</summary>

1. **Auth form flash before redirect** — An already-authenticated user loading `/auth` directly will see the login form briefly before the `useEffect` redirect fires on the next render cycle. Guard by rendering nothing (or a spinner) while `isValidating` is true, or while `isAuthenticated && !isValidating`.

2. **Low-confidence response uses HTTP 200** — `POST /predict` returns `{ success: false, status: "unrecognized" }` with a 200 status for below-threshold images. Any consumer that checks only the HTTP status code will silently treat this as a successful prediction. Document the contract, or use 422 Unprocessable Entity so HTTP-level error handling catches it.

3. **Revoked tokens stay live on network error** — `AuthContext` calls `setIsValidating(false)` without clearing the user when the `/api/auth/validate` call fails with a network error. A user whose token was revoked server-side will remain authenticated in the app indefinitely if the backend is unreachable at startup. Consider tracking the last successful validation timestamp and enforcing a maximum offline grace period.

</details>

---

<details>
<summary>Details</summary>

### `isValidating` guard and the auth redirect loop

`AuthContext` initializes `isValidating` to `true` when both a stored token and a stored user object exist in `localStorage`, then sets it to `false` after the `/api/auth/validate` call resolves (or rejects). Before this fix, `Language.tsx` called `navigate('/auth')` unconditionally on mount, which ran before `isValidating` settled. The resulting sequence was: page loads → navigate to `/auth` → `AuthContext` finishes validation → `isAuthenticated` becomes true → nothing catches it → user is stuck on the auth page.

Both pages now wait for `!isValidating` before acting. `Language.tsx`'s `useEffect` redirects to `/dashboard` when `!isValidating && isAuthenticated`, and `handleContinue` routes to `/dashboard` vs `/auth` based on `isAuthenticated`. `Auth.tsx` has the same effect. The dependency arrays are `[isAuthenticated, isValidating, navigate]` in both cases — correct, no missing dependencies, no stale closure.

The remaining edge case: when a logged-in user lands on `/auth`, the component renders fully before the effect fires. The auth form, tabs, and inputs are all mounted and visible for one render cycle. This is usually imperceptible (~16ms) but is visible on slow devices or when the component is heavy. A `if (isValidating || isAuthenticated) return null` early return would eliminate it.

### Confidence threshold and the HTTP 200 contract

The `/predict` endpoint applies a 0.55 confidence threshold. Below that, it returns:

```json
{ "success": false, "status": "unrecognized", "low_confidence": true, "confidence": 0.42, "message": "..." }
```

with HTTP 200. The comment explains the choice: the backend proxy should forward it rather than treat it as a server error. That is a reasonable design, but it creates a silent failure mode: any consumer that branches on HTTP status code rather than the `status` field will interpret this as a successful zero-disease prediction. The shape of the above JSON (`success: false` alongside 200) is also inconsistent — `success: false` normally signals a request-handling error, not a valid-but-inconclusive result. Using HTTP 422 (or a dedicated `status: unrecognized` with `success: true`) would make the intent clearer.

The 38-class PlantVillage model has no explicit "not a plant" class. The threshold is effectively an out-of-distribution proxy: if the softmax maximum is below 0.55, the image is probably not from the training distribution. This works reasonably well in practice but will still confidently misclassify some non-plant images that happen to resemble a training class (e.g. a greenish background). It is the right approach given the model architecture, and 0.55 is a defensible threshold for this dataset.


</details>

---

<details>
<summary>File map</summary>

- `frontend/src/pages/Language.tsx` — added `isAuthenticated`/`isValidating` check; `useEffect` redirect to `/dashboard`; `handleContinue` routes based on auth state
- `frontend/src/pages/Auth.tsx` — added `isAuthenticated`/`isValidating` to `useAuth()` destructure; `useEffect` redirect to `/dashboard` when already authenticated
- `d_disease/flask_api.py` — new file: Flask REST API wrapping the TFLite plant disease model; `/predict` with 0.55 confidence threshold; `/health` endpoint
- `d_disease/requirements_flask.txt` — new file: pinned Python dependencies for the Flask service
- `backend/index.js` — no code change; startup sequence confirmed correct (pre-existing)

Full diff: `git diff main -- frontend/src/pages/Language.tsx frontend/src/pages/Auth.tsx d_disease/flask_api.py d_disease/requirements_flask.txt backend/index.js`

</details>
