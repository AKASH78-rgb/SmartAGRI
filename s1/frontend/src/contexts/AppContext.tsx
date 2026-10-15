import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { weatherAPI, WeatherData } from "@/services/api";

type Language = "en" | "hi" | "te" | "kn" | "mr";

interface Coords {
  lat: number;
  lng: number;
  timestamp: number;
}

// Granular loading phase so UI can show exact status messages
export type WeatherPhase =
  | 'idle'
  | 'locating'        // "Getting your location..."
  | 'fetching'        // "Fetching weather..."
  | 'ready'
  | 'error';

export interface AppContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  coords: Coords | null;
  setCoords: (lat: number, lng: number) => void;
  coordsLoading: boolean;

  // Weather state & actions
  weatherData: WeatherData | null;
  weatherLoading: boolean;
  weatherPhase: WeatherPhase;
  weatherError: string | null;
  locationPermissionDenied: boolean;
  lastUpdatedText: string;
  refreshWeather: () => Promise<void>;
  searchWeatherByCity: (city: string) => Promise<boolean>;
  requestGeolocation: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
};

const COORDS_MAX_AGE = 10 * 60 * 1000; // 10 minutes
const COORDS_STORAGE_KEY = "smartagricare_coords_v2";
const FALLBACK_LAT = 15.8497; // Belagavi, Karnataka
const FALLBACK_LNG = 74.4977;
const MAX_TRUSTED_ACCURACY_M = 8000;
// No untrusted-GPS city overrides for the Karnataka deployment
const UNTRUSTED_GPS_CITIES: string[] = [];

function loadCachedCoords(): Coords | null {
  try {
    const stored = sessionStorage.getItem(COORDS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && Date.now() - parsed.timestamp < COORDS_MAX_AGE) return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function getRelativeTimeText(lastFetchedMs: number | null): string {
  if (!lastFetchedMs) return "Just now";
  const diffSec = Math.floor((Date.now() - lastFetchedMs) / 1000);
  if (diffSec < 30) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 1) return "Just now";
  if (diffMin === 1) return "1 minute ago";
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours === 1) return "1 hour ago";
  return `${diffHours} hours ago`;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem("smartagricare_lang");
      if (stored === "en" || stored === "hi" || stored === "te" || stored === "kn" || stored === "mr") return stored;
      return "en";
    } catch {
      return "en";
    }
  });

  const [coords, setCoordsState] = useState<Coords | null>(loadCachedCoords);
  const [coordsLoading, setCoordsLoading] = useState(() => !loadCachedCoords());

  // Weather state
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(true);
  const [weatherPhase, setWeatherPhase] = useState<WeatherPhase>('idle');
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState<boolean>(false);
  const [lastFetchedMs, setLastFetchedMs] = useState<number | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState<string>("Just now");

  const lastSearchedCityRef = useRef<string | null>(null);

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    try { localStorage.setItem("smartagricare_lang", lang); } catch { /* quota exceeded */ }
  };

  const setCoords = useCallback((lat: number, lng: number, accuracy?: number) => {
    if (typeof accuracy === 'number' && accuracy > MAX_TRUSTED_ACCURACY_M) {
      setCoordsState({ lat: FALLBACK_LAT, lng: FALLBACK_LNG, timestamp: Date.now() });
      setCoordsLoading(false);
      return;
    }
    const c: Coords = { lat, lng, timestamp: Date.now() };
    setCoordsState(c);
    setCoordsLoading(false);
    try { sessionStorage.setItem(COORDS_STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
  }, []);

  // Core weather fetch — always goes to backend which proxies to OWM/Open-Meteo
  const fetchWeather = useCallback(async (lat?: number, lng?: number, query?: string): Promise<boolean> => {
    setWeatherLoading(true);
    setWeatherPhase('fetching');
    setWeatherError(null);
    try {
      const targetLat = lat ?? FALLBACK_LAT;
      const targetLng = lng ?? FALLBACK_LNG;
      const data = await weatherAPI.getCurrentWeather(targetLat, targetLng, query);
      if (data && (data.temperature !== undefined || data.location)) {
        const loc = String(data.location || '').toLowerCase();
        const patched = UNTRUSTED_GPS_CITIES.some(city => loc.includes(city))
          ? { ...data, location: 'Belagavi, IN', lat: FALLBACK_LAT, lon: FALLBACK_LNG }
          : data;
        setWeatherData(patched);
        setLastFetchedMs(Date.now());
        setLastUpdatedText("Just now");
        setWeatherError(null);
        setWeatherPhase('ready');
        setWeatherLoading(false);
        if (query) lastSearchedCityRef.current = query;
        else lastSearchedCityRef.current = null;
        return true;
      } else {
        throw new Error("Invalid weather data response");
      }
    } catch (err: any) {
      console.warn("Weather fetch error:", err.message);
      const msg = err.message?.includes("not found")
        ? "Location not found. Please try another city."
        : "Unable to fetch weather. Please try again later.";
      setWeatherError(msg);
      setWeatherPhase('error');
      setWeatherLoading(false);
      return false;
    }
  }, []);

  const refreshWeather = useCallback(async () => {
    if (lastSearchedCityRef.current) {
      await fetchWeather(undefined, undefined, lastSearchedCityRef.current);
    } else {
      const cached = loadCachedCoords();
      await fetchWeather(cached?.lat, cached?.lng);
    }
  }, [fetchWeather]);

  const searchWeatherByCity = useCallback(async (city: string): Promise<boolean> => {
    if (!city.trim()) return false;
    return await fetchWeather(undefined, undefined, city.trim());
  }, [fetchWeather]);

  const requestGeolocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationPermissionDenied(true);
      setCoords(FALLBACK_LAT, FALLBACK_LNG);
      fetchWeather(FALLBACK_LAT, FALLBACK_LNG);
      return;
    }
    setWeatherPhase('locating');
    setWeatherLoading(true);
    setCoordsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocationPermissionDenied(false);
        const accuracy = pos.coords.accuracy;
        if (typeof accuracy === 'number' && accuracy > MAX_TRUSTED_ACCURACY_M) {
          setCoords(FALLBACK_LAT, FALLBACK_LNG);
          fetchWeather(FALLBACK_LAT, FALLBACK_LNG);
          return;
        }
        setCoords(pos.coords.latitude, pos.coords.longitude, accuracy);
        fetchWeather(pos.coords.latitude, pos.coords.longitude);
      },
      err => {
        console.warn("Geolocation error code:", err.code, err.message);
        setLocationPermissionDenied(true);
        setCoordsLoading(false);
        setCoords(FALLBACK_LAT, FALLBACK_LNG);
        fetchWeather(FALLBACK_LAT, FALLBACK_LNG);
      },
      { timeout: 15000, enableHighAccuracy: true, maximumAge: 0 }
    );
  }, [fetchWeather, setCoords]);

  // One-time geolocation on app init
  // Strategy: immediately fetch with fallback coords (instant weather),
  // then re-fetch with real GPS coords once available.
  useEffect(() => {
    const cached = loadCachedCoords();
    if (cached) {
      // Have fresh GPS coords — use them directly
      setCoordsState(cached);
      setCoordsLoading(false);
      fetchWeather(cached.lat, cached.lng);
    } else {
      // No cached coords — fetch weather immediately with fallback so
      // the card isn't stuck on "Getting your location..." forever,
      // then silently upgrade to real GPS if permission is granted.
      fetchWeather(FALLBACK_LAT, FALLBACK_LNG);

      if (navigator.geolocation) {
        setWeatherPhase('locating');
        setCoordsLoading(true);
        navigator.geolocation.getCurrentPosition(
          pos => {
            setLocationPermissionDenied(false);
            const accuracy = pos.coords.accuracy;
            if (typeof accuracy === 'number' && accuracy > MAX_TRUSTED_ACCURACY_M) {
              setCoords(FALLBACK_LAT, FALLBACK_LNG);
              fetchWeather(FALLBACK_LAT, FALLBACK_LNG);
              return;
            }
            setCoords(pos.coords.latitude, pos.coords.longitude, accuracy);
            fetchWeather(pos.coords.latitude, pos.coords.longitude);
          },
          err => {
            console.warn("Geolocation error:", err.code, err.message);
            setLocationPermissionDenied(true);
            setCoordsLoading(false);
            setCoords(FALLBACK_LAT, FALLBACK_LNG);
          },
          { timeout: 15000, enableHighAccuracy: true, maximumAge: 0 }
        );
      } else {
        setLocationPermissionDenied(true);
        setCoords(FALLBACK_LAT, FALLBACK_LNG);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for native location from Android WebView
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'NATIVE_LOCATION' && data.coords) {
          setLocationPermissionDenied(false);
          setCoords(data.coords.latitude, data.coords.longitude);
          fetchWeather(data.coords.latitude, data.coords.longitude);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fetchWeather, setCoords]);

  // Auto-refresh weather every 10 minutes (background refresh, silent)
  useEffect(() => {
    const interval = setInterval(() => {
      refreshWeather();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshWeather]);

  // Update "Last updated: X minutes ago" text every 15 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastFetchedMs) {
        setLastUpdatedText(getRelativeTimeText(lastFetchedMs));
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [lastFetchedMs]);

  return (
    <AppContext.Provider value={{
      language, setLanguage: handleSetLanguage,
      coords, setCoords, coordsLoading,
      weatherData, weatherLoading, weatherPhase, weatherError, locationPermissionDenied,
      lastUpdatedText, refreshWeather, searchWeatherByCity, requestGeolocation,
    }}>
      {children}
    </AppContext.Provider>
  );
};
