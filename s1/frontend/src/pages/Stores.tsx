import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { storeAPI } from "@/services/api";
import { useApp } from "@/contexts/AppContext";
import { t, type Language } from "@/lib/i18n";
import MobileLayout from "@/components/MobileLayout";
import { MapPin, Navigation, Search, Star, ShoppingBag, ExternalLink, Map, RefreshCw, Sun, Cloud, CloudRain, CloudSun, CloudLightning, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface Store {
  id: number | string;
  name: string;
  category: string;
  rating?: string | null;
  distance: string;
  distanceKm: number;
  address: string;
  open: boolean | null;
  lat: number;
  lng: number;
  phone?: string;
  district?: string;
  source?: string;
  locationApproximate?: boolean;
}

type LocationStatus = "locating" | "available" | "denied" | "unavailable";

const KARNATAKA_DISTRICTS = [
  'Bagalkot', 'Belagavi', 'Davanagere', 'Dharwad', 'Gadag', 'Haveri',
  'Chitradurga', 'Uttara Kannada', 'Vijayapura', 'Shivamogga', 'Chikkaballapur'
];

const StoreSkeleton = () => (
  <div className="rounded-2xl bg-card p-4 shadow-card animate-pulse">
    <div className="flex items-start gap-3 mb-3">
      <div className="h-10 w-10 rounded-xl bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
      </div>
      <div className="h-5 w-12 rounded-full bg-muted" />
    </div>
    <div className="flex items-center gap-3 mb-3">
      <div className="h-3 w-8 rounded bg-muted" />
      <div className="h-3 w-2/3 rounded bg-muted" />
    </div>
    <div className="h-10 w-full rounded-xl bg-muted" />
  </div>
);

const MapSkeleton = ({ language }: { language: Language }) => (
  <div className="rounded-2xl overflow-hidden border border-border shadow-card">
    <div className="h-[220px] w-full bg-muted animate-pulse flex items-center justify-center">
      <Map className="h-8 w-8 text-muted-foreground/30" />
    </div>
    <p className="text-center text-[10px] text-muted-foreground py-1.5 bg-card animate-pulse">
      {t('loading_map', language)}
    </p>
  </div>
);

const Stores = () => {
  const { language } = useApp();
  const languageRef = useRef(language);
  languageRef.current = language;
  const [stores, setStores] = useState<Store[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showMap, setShowMap] = useState(true);
  const [liveCoords, setLiveCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("locating");
  const [selectedDistrict, setSelectedDistrict] = useState(() => {
    const requestedDistrict = new URLSearchParams(window.location.search).get("district");
    return KARNATAKA_DISTRICTS.find(
      district => district.toLowerCase() === requestedDistrict?.trim().toLowerCase()
    ) || "";
  });

  const isMounted = useRef(true);
  const lastStoreFetch = useRef({ t: 0, lat: 0, lng: 0 });
  const liveCoordsRef = useRef(liveCoords);
  liveCoordsRef.current = liveCoords;
  const selectedDistrictRef = useRef(selectedDistrict);
  selectedDistrictRef.current = selectedDistrict;
  const applyPositionRef = useRef<(lat: number, lng: number) => void>(() => {});

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchStores = useCallback(async (
    lat: number | null,
    lng: number | null,
    district = selectedDistrictRef.current
  ) => {
    if (!isMounted.current) return;
    if ((lat === null || lng === null) && !district) {
      setStores([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await storeAPI.getNearbyStores(lat, lng, district || undefined);
      if (isMounted.current) setStores(data?.stores || []);
    } catch {
      if (isMounted.current) {
        setStores([]);
        toast.error(t('stores_fetch_error', languageRef.current));
      }
    }
    if (isMounted.current) setLoading(false);
  }, []);

  // Update live position + refetch stores on meaningful movement
  const applyPosition = (lat: number, lng: number) => {
    if (!isMounted.current) return;
    const previousCoords = liveCoordsRef.current;
    liveCoordsRef.current = { lat, lng };
    setLiveCoords({ lat, lng });
    setLocationStatus("available");
    const now = Date.now();
    const prev = lastStoreFetch.current;
    const distKm = Math.sqrt((lat - prev.lat) ** 2 + (lng - prev.lng) ** 2) * 111;
    if (previousCoords && distKm < 0.1) return;
    if (now - prev.t < 10_000) return;
    lastStoreFetch.current = { t: now, lat, lng };
    void fetchStores(lat, lng, selectedDistrictRef.current);
  };
  applyPositionRef.current = applyPosition;

  // Load a URL-selected district even when device location is unavailable.
  useEffect(() => {
    const position = liveCoordsRef.current;
    void fetchStores(position?.lat ?? null, position?.lng ?? null, selectedDistrict);
  }, [fetchStores, selectedDistrict]);

  // Native GPS message handler (Expo wrapper) — real-time position
  useEffect(() => {
    const nativeHandler = (event: MessageEvent) => {
      try {
        if (!event.data) return;
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'NATIVE_LOCATION') {
          applyPositionRef.current(data.coords.latitude, data.coords.longitude);
        }
      } catch {
        // Ignore JSON parse errors
      }
    };

    window.addEventListener("message", nativeHandler);
    return () => { window.removeEventListener("message", nativeHandler); };
  }, []);

  // Real-time GPS tracking — re-centers map + refreshes stores as you move
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unavailable");
      return;
    }
    const handleLocationError = (error: GeolocationPositionError) => {
      if (liveCoordsRef.current) return;
      setLocationStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      if (!selectedDistrictRef.current) setLoading(false);
    };
    const watchId = navigator.geolocation.watchPosition(
      pos => applyPositionRef.current(pos.coords.latitude, pos.coords.longitude),
      handleLocationError,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Real-time store data refresh every 60s
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isMounted.current) return;
      const pos = liveCoordsRef.current;
      if (pos) {
        void fetchStores(pos.lat, pos.lng, selectedDistrictRef.current);
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [fetchStores]);

  // Memoize filtered stores
  const filtered = useMemo(() =>
    stores.filter(s =>
      !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.category.toLowerCase().includes(search.toLowerCase())
    ),
    [stores, search]
  );

  const userLat = liveCoords?.lat ?? null;
  const userLng = liveCoords?.lng ?? null;

  const mapSrc = useMemo(() => {
    if (userLat == null || userLng == null) return null;
    const delta = 0.27;
    const bbox = `${userLng - delta},${userLat - delta},${userLng + delta},${userLat + delta}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${userLat},${userLng}`;
  }, [userLat, userLng]);

  const openNavigation = (store: Store) => {
    const destination = store.source === "karnataka_database"
      ? `${store.name}, ${store.district || "Karnataka"}, Karnataka`
      : `${store.lat},${store.lng}`;
    const params = new URLSearchParams({ api: "1", destination });
    if (userLat != null && userLng != null) params.set("origin", `${userLat},${userLng}`);
    const url = `https://www.google.com/maps/dir/?${params.toString()}`;
    window.open(url, "_blank");
  };

  const refreshStores = () => {
    if (userLat != null && userLng != null) {
      void fetchStores(userLat, userLng, selectedDistrictRef.current);
    } else if (selectedDistrict) {
      void fetchStores(null, null, selectedDistrict);
    }
  };

  const requestCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unavailable");
      return;
    }
    setLocationStatus("locating");
    navigator.geolocation.getCurrentPosition(
      position => applyPositionRef.current(position.coords.latitude, position.coords.longitude),
      error => setLocationStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return (
    <MobileLayout>
      <div className="px-5 pt-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold text-foreground">{t('local_stores', language)}</h1>
          <button onClick={refreshStores} disabled={loading} className="flex items-center gap-1 text-sm font-medium text-accent disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">{t('find_stores', language)}</p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('search_stores', language)}
            aria-label={t('search_stores', language)}
            className="w-full rounded-xl border border-border bg-card py-3 pl-10 pr-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* District Selector */}
        <div className="mb-4">
          <div className="relative">
            <select
              value={selectedDistrict}
              onChange={e => {
                setSelectedDistrict(e.target.value);
              }}
              className="w-full rounded-xl border border-border bg-card py-3 pl-4 pr-10 text-foreground focus:outline-none focus:ring-2 focus:ring-accent appearance-none"
            >
              <option value="">Select District (Optional)</option>
              {KARNATAKA_DISTRICTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {locationStatus !== "available" && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <p>
              {locationStatus === "locating"
                ? "Getting your device location…"
                : locationStatus === "denied"
                ? "Location permission was denied. Choose a district or enable location and try again."
                : "Your device location is unavailable. Choose a district to browse its listed stores."}
            </p>
            {locationStatus !== "locating" && (
              <button type="button" onClick={requestCurrentLocation} className="mt-2 font-semibold underline">
                Try device location again
              </button>
            )}
          </div>
        )}
        {locationStatus === "available" && (
          <p className="mb-4 text-xs text-muted-foreground">
            Using your device’s current location for store distances and directions.
          </p>
        )}

        {stores.some(store => store.source === "karnataka_database") && (
          <p className="mb-4 rounded-xl border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            Directory entries are from the supplied dataset. Map pins are approximate district centers, not verified shop locations; product listings are illustrative. Call ahead to confirm the shop address and stock.
          </p>
        )}

        {/* Map Toggle + OpenStreetMap Embed */}
        <div className="mb-4">
          <button
            onClick={() => setShowMap(!showMap)}
            className="flex items-center gap-2 text-sm font-medium text-accent mb-2"
          >
            <Map className="h-4 w-4" />
            {showMap ? t('hide_map', language) : t('show_map', language)}
          </button>
          {showMap && (
            mapSrc ? (
              <div className="rounded-2xl overflow-hidden border border-border shadow-card">
                <iframe
                  src={mapSrc}
                  width="100%"
                  height="220"
                  style={{ border: 0 }}
                  loading="lazy"
                  title="Nearby agricultural stores"
                  className="overflow-hidden"
                />
                <style>{`
                  iframe {
                    position: relative;
                  }
                  iframe::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 40px;
                    background: white;
                    z-index: 10;
                  }
                `}</style>
              </div>
            ) : locationStatus === "locating" ? (
              <MapSkeleton language={language} />
            ) : (
              <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-muted/30 px-6 text-center text-sm text-muted-foreground">
                <MapPin className="h-6 w-6" />
                <p>Map centered on your device location will appear when location access is available.</p>
                <button type="button" onClick={requestCurrentLocation} className="font-semibold text-accent underline">
                  Try device location again
                </button>
              </div>
            )
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3 pb-4">
            {[1, 2, 3, 4].map(i => <StoreSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ShoppingBag className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">{t('no_stores_found', language)}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{t('no_stores_subtitle', language)}</p>
          </div>
        ) : (
          <div className="space-y-3 pb-4">
            {filtered.map((store, i) => (
              <motion.div
                key={store.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl bg-card p-4 shadow-card"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                    <MapPin className="h-5 w-5 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{store.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{store.category}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${store.open === null ? "bg-muted text-muted-foreground" : store.open ? "bg-accent/20 text-accent" : "bg-destructive/20 text-destructive"}`}>
                      {store.open === null ? "—" : store.open ? t('open', language) : t('closed', language)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {store.locationApproximate ? "~ " : ""}{store.distance}
                    </span>
                  </div>
                </div>

                <div className="mb-3 flex items-center gap-3">
                  {store.rating && (
                    <div className="flex items-center gap-0.5">
                      <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                      <span className="text-xs font-medium text-foreground">{store.rating}</span>
                    </div>
                  )}
                  {store.address && (
                    <span className="truncate text-xs text-muted-foreground">{store.address}</span>
                  )}
                </div>

                {/* Karnataka shop additional info */}
                {store.source === 'karnataka_database' && (
                  <div className="space-y-2 mb-3">
                    {store.phone && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">{t('phone', language)}: </span>
                        <a href={`tel:${store.phone}`} className="text-accent hover:underline">{store.phone}</a>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => openNavigation(store)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary/10 py-2.5 text-sm font-medium text-primary transition-colors active:bg-primary/20"
                >
                  <Navigation className="h-4 w-4" />
                  {t('navigate', language)}
                  <ExternalLink className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </MobileLayout>
  );
};

export default Stores;
