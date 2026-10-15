// API goes through Vite proxy (/api → localhost:5000), so use same origin
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

async function apiFetch<T = any>(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<T> {
    const token = localStorage.getItem('smartagricare_token');
    const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    // Skip ngrok browser interstitial on free tier
    headers['ngrok-skip-browser-warning'] = 'true';

    // Add timeout
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { ...options, headers, signal: controller.signal });
        clearTimeout(id);
        const text = await res.text();
        let data: any;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(`Server returned invalid response (${res.status})`);
        }
        if (!res.ok) {
            if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/register')) {
                localStorage.removeItem('smartagricare_token');
                localStorage.removeItem('smartagricare_user');
                window.location.href = '/auth';
            }
            throw new Error(data.error || `Request failed: ${res.status}`);
        }
        return data;
    } catch (err: any) {
        clearTimeout(id);
        if (err.name === 'AbortError') throw new Error("Request timeout. Server unreachable.");
        throw err;
    }
}

/** Retry wrapper — retries on timeout/network errors with exponential backoff */
async function apiFetchWithRetry<T = any>(
    url: string, options: RequestInit = {}, timeoutMs = 30000, retries = 2
): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await apiFetch<T>(url, options, timeoutMs);
        } catch (err: any) {
            const isRetryable = err.message?.includes('timeout') ||
                err.message?.includes('Failed to fetch') ||
                err.message?.includes('NetworkError') ||
                err.message?.includes('Server returned invalid');
            if (attempt === retries || !isRetryable) throw err;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
    throw new Error('Request failed after retries');
}

export const authAPI = {
    login: (email: string, password: string) =>
        apiFetch(`${API_BASE_URL}/api/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }) }),
    register: (name: string, email: string, password: string, phone = '') =>
        apiFetch(`${API_BASE_URL}/api/auth/register`, { method: 'POST', body: JSON.stringify({ name, email, password, phone }) }),
    forgotPassword: (email: string) =>
        apiFetch(`${API_BASE_URL}/api/auth/forgot-password`, { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (email: string, otp: string, newPassword: string) =>
        apiFetch(`${API_BASE_URL}/api/auth/reset-password`, { method: 'POST', body: JSON.stringify({ email, otp, newPassword }) }),
    updateProfile: (userId: number, fields: { name?: string; phone?: string; location?: string }) =>
        apiFetch(`${API_BASE_URL}/api/auth/profile`, { method: 'PUT', body: JSON.stringify({ userId, ...fields }) }),
    validate: async (token: string): Promise<{ success: boolean }> => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/auth/validate`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'ngrok-skip-browser-warning': 'true',
                },
            });
            const data = await res.json();
            return data;
        } catch {
            return { success: true }; // network error — don't logout, server may be starting
        }
    },
};

export interface WeatherData {
    location: string;
    temperature: number;
    feelsLike: number;
    feels_like?: number;
    humidity: number;
    rainfall: number;
    precipitation?: number;
    windSpeed: number;
    wind_speed?: number;
    wind_deg?: number | null;
    pressure: number;
    visibility?: number | null;   // km, null if unavailable
    condition: string;
    weather_condition?: string;
    description: string;
    weather_description?: string;
    icon: string;
    weather_icon?: string;
    iconCode?: string;
    source?: string;              // 'OpenWeatherMap' | 'Open-Meteo'
    lastUpdated: string;
    last_updated?: string;
    lat?: number;
    lon?: number;
    forecast?: any[];
}

export const weatherAPI = {
    getCurrentWeather: (lat?: number, lng?: number, query?: string) => {
        let url = `${API_BASE_URL}/api/weather`;
        if (query && query.trim()) {
            url += `?q=${encodeURIComponent(query.trim())}`;
        } else if (lat !== undefined && lng !== undefined) {
            url += `?lat=${lat}&lon=${lng}&lng=${lng}`;
        }
        return apiFetch<{ success: boolean; weather: WeatherData }>(url).then(d => d.weather || (d as any));
    },
};

export const diseaseAPI = {
    getServiceStatus: () =>
        apiFetch(`${API_BASE_URL}/api/ml-status`, {}, 8000),
    detectDisease: (imageFile: File, language?: string) => {
        const formData = new FormData();
        formData.append('image', imageFile);
        const extraHeaders: Record<string, string> = {};
        if (language && language !== 'en') extraHeaders['X-Language'] = language;
        return apiFetchWithRetry(`${API_BASE_URL}/api/disease/detect`, {
            method: 'POST', body: formData, headers: extraHeaders,
        }, 60000, 2);
    },
    saveReport: (report: { userId?: number; disease: string; confidence: number; cause: string; treatment: string[]; stores: string[]; imageName?: string }) =>
        apiFetch(`${API_BASE_URL}/api/disease/report`, { method: 'POST', body: JSON.stringify(report) }),
    getReports: (userId: number) =>
        apiFetch(`${API_BASE_URL}/api/disease/reports?userId=${userId}`),
};

export interface CropRecommendationHistoryItem {
    id: number;
    season: string;
    soil: string;
    water: string;
    district: string;
    land: string;
    topCrop: string;
    topMatch: number;
    results: Array<{ name: string; match: number; emoji?: string; period?: string; water?: string; fertilizer?: string; districts?: string[] }>;
    createdAt: string;
}

export const cropAPI = {
    getMeta: () =>
        apiFetch(`${API_BASE_URL}/api/crop-meta`),
    getRecommendations: (season: string, soil?: string, water?: string, district?: string, land?: string) =>
        apiFetch(`${API_BASE_URL}/api/crops/recommend`, {
            method: 'POST',
            body: JSON.stringify({ season, soil, water, district, land }),
        }),
    getCropDetails: (name: string) =>
        apiFetch(`${API_BASE_URL}/api/crops/${encodeURIComponent(name)}`),
    getHistory: () =>
        apiFetch<{ success: boolean; history: CropRecommendationHistoryItem[] }>(`${API_BASE_URL}/api/crop-recommendations/history`),
};

export const storeAPI = {
    getNearbyStores: (lat: number | null, lng: number | null, district?: string, radius?: number) => {
        const params = new URLSearchParams();
        if (lat !== null && lng !== null) {
            params.set('lat', String(lat));
            params.set('lng', String(lng));
        }
        if (district) params.set('district', district);
        if (radius) params.set('radius', String(radius));
        return apiFetch(`${API_BASE_URL}/api/stores/nearby?${params.toString()}`, {}, 30000);
    },
};

export const voiceAPI = {
    processQuery: (query: string, language?: string, history?: { role: string; content: string }[], weatherContext?: any, farmerProfile?: any) =>
        apiFetchWithRetry(`${API_BASE_URL}/api/voice/query`, {
            method: 'POST',
            body: JSON.stringify({ query, language, history: history || [], weatherContext, farmerProfile }),
        }, 60000, 1),
    saveHistory: (messages: { role: string; text: string; timestamp: number }[]) =>
        apiFetch(`${API_BASE_URL}/api/voice/history/save`, {
            method: 'POST',
            body: JSON.stringify({ messages }),
        }),
    getHistory: () =>
        apiFetch(`${API_BASE_URL}/api/voice/history`),
    getMarketPrice: (crop: string) =>
        apiFetch(`${API_BASE_URL}/api/voice/market-price?crop=${encodeURIComponent(crop)}`, {}, 8000),
};

export interface SoilClimatePayload {
    n: number;
    p: number;
    k: number;
    ph: number;
    temperature: number;
    humidity: number;
    rainfall: number;
    language?: string;
}

export const cropFertilizerAPI = {
    getMeta: () =>
        apiFetch(`${API_BASE_URL}/api/crop-fertilizer/meta`),
    analyze: (payload: SoilClimatePayload) =>
        apiFetch(`${API_BASE_URL}/api/crop-fertilizer/analyze`, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
};

export const soilAPI = {
    submitInquiry: (payload: {
        name: string;
        phone: string;
        village?: string;
        district?: string;
        landAcres?: string;
        crop?: string;
        soilType?: string;
        notes?: string;
    }) =>
        apiFetch(`${API_BASE_URL}/api/soil/inquiry`, {
            method: 'POST',
            body: JSON.stringify(payload),
        }),
    getInquiries: () =>
        apiFetch<{ success: boolean; inquiries: Array<{
            id: number;
            name: string;
            phone: string;
            village: string;
            district: string;
            landAcres: number | null;
            crop: string;
            soilType: string;
            notes: string;
            createdAt: string;
        }> }>(`${API_BASE_URL}/api/soil/inquiries`),
};
