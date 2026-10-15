import { useAuth } from "@/contexts/AuthContext";
import { useApp } from "@/contexts/AppContext";
import { useNavigate } from "react-router-dom";
import MobileLayout from "@/components/MobileLayout";
import { MapPin, Droplets, Cloud, Wind, Bug, Globe, Check, Sun, Mic, CloudRain, CloudDrizzle, CloudSnow, CloudLightning, CloudFog, CloudSun, RefreshCw, Sparkles, Search, Thermometer, ArrowDown, AlertTriangle, Eye, Gauge, Navigation, FlaskConical, Phone, MessageCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef } from "react";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import { soilAPI } from "@/services/api";
import dashboardHero from "/farm1.jpg";

const SOIL_EXPERT_PHONE = "9164205118";
const SOIL_EXPERT_TEL = "+919164205118";

const languages = [
  { code: "en" as const, name: "English", native: "English", badge: "A",  badgeSub: "EN", color: "bg-blue-100 text-blue-700" },
  { code: "hi" as const, name: "Hindi",   native: "हिंदी",   badge: "अ",  badgeSub: "HI", color: "bg-orange-100 text-orange-700" },
  { code: "te" as const, name: "Telugu",  native: "తెలుగు",  badge: "అ",  badgeSub: "TE", color: "bg-green-100 text-green-700" },
  { code: "kn" as const, name: "Kannada", native: "ಕನ್ನಡ",  badge: "ಅ",  badgeSub: "KN", color: "bg-purple-100 text-purple-700" },
  { code: "mr" as const, name: "Marathi", native: "मराठी",  badge: "म",  badgeSub: "MR", color: "bg-red-100 text-red-700" },
];

function getWeatherIcon(condition?: string, iconUrl?: string) {
  if (iconUrl) {
    return <img src={iconUrl} alt={condition} className="h-16 w-16 drop-shadow-md" />;
  }
  const cond = (condition || '').toLowerCase();
  if (cond.includes('clear') || cond.includes('sun')) return <Sun className="h-14 w-14 opacity-90 text-yellow-300" />;
  if (cond.includes('cloud')) return <Cloud className="h-14 w-14 opacity-90 text-sky-200" />;
  if (cond.includes('rain') || cond.includes('drizzle')) return <CloudRain className="h-14 w-14 opacity-90 text-blue-300" />;
  if (cond.includes('thunder') || cond.includes('storm')) return <CloudLightning className="h-14 w-14 opacity-90 text-amber-300" />;
  return <CloudSun className="h-14 w-14 opacity-90 text-sky-200" />;
}

const Dashboard = () => {
  const { user } = useAuth();
  const {
    language,
    setLanguage,
    weatherData,
    weatherLoading,
    weatherPhase,
    weatherError,
    locationPermissionDenied,
    lastUpdatedText,
    refreshWeather,
    searchWeatherByCity,
    requestGeolocation
  } = useApp();

  const navigate = useNavigate();
  const [showLangModal, setShowLangModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchCity, setSearchCity] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSoilForm, setShowSoilForm] = useState(false);
  const [soilSubmitting, setSoilSubmitting] = useState(false);
  const [soilForm, setSoilForm] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    village: "",
    district: "Belagavi",
    landAcres: "",
    crop: "",
    soilType: "",
    notes: "",
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshWeather();
    setIsRefreshing(false);
    toast.success(t('weather_refreshed', language));
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchCity.trim()) return;
    setSearchLoading(true);
    const ok = await searchWeatherByCity(searchCity);
    setSearchLoading(false);
    if (ok) {
      toast.success(`${t('weather_refreshed', language)}: ${searchCity}`);
      setShowSearchModal(false);
      setSearchCity("");
    } else {
      toast.error(t('location_not_found', language));
    }
  };

  const handleSoilSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!soilForm.name.trim() || !soilForm.phone.trim() || !soilForm.district.trim()) {
      toast.error(t('required_fields', language));
      return;
    }
    setSoilSubmitting(true);
    try {
      await soilAPI.submitInquiry(soilForm);
      toast.success(t('soil_submit_ok', language));
      setShowSoilForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('soil_submit_fail', language));
    } finally {
      setSoilSubmitting(false);
    }
  };

  const activities = [
    { icon: FlaskConical, title: t('know_your_soil', language), sub: t('know_your_soil_sub', language), badge: t('contact_soil_expert', language), badgeColor: "bg-emerald-100 text-emerald-700", link: "__soil__" },
    { icon: Sparkles, title: t('crop_fertilizer_title', language), sub: t('crop_fertilizer_sub', language), badge: "", badgeColor: "", link: "/crop-fertilizer" },
    { icon: Bug, title: t('disease_detection', language), sub: t('take_photo', language), badge: t('scan', language), badgeColor: "bg-accent/20 text-accent", link: "/disease-detection" },
    { icon: MapPin, title: t('local_stores', language), sub: t('find_stores', language), badge: t('open', language), badgeColor: "bg-accent/20 text-accent", link: "/stores" },
    { icon: Mic, title: t('voice_assistant', language), sub: t('ask_anything', language), badge: "AI", badgeColor: "bg-purple-100 text-purple-600", link: "/voice-assistant" },
    { icon: Globe, title: t('language', language), sub: languages.find(l => l.code === language)?.native || "English", badge: t('change', language), badgeColor: "bg-muted text-muted-foreground", link: null },
  ];

  const handleActivityClick = (link: string | null) => {
    if (link === "__soil__") setShowSoilForm(true);
    else if (link) navigate(link);
    else setShowLangModal(true);
  };

  // Compute irrigation advice based on live weather data
  const temp = weatherData?.temperature ?? 27;
  const rain = weatherData?.rainfall ?? weatherData?.precipitation ?? 0;
  const humidity = weatherData?.humidity ?? 72;
  let irrigationAdvice = `💧 ${t('irrigation_ok', language)}`;
  if (rain > 2 || humidity > 80) {
    irrigationAdvice = `🌧️ ${t('irrigation_skip', language)}`;
  } else if (temp > 32 && rain < 1) {
    irrigationAdvice = `☀️ ${t('irrigation_water', language)}`;
  }

  return (
    <MobileLayout>
      {/* Hero background */}
      <div className="relative">
        <img src={dashboardHero} alt="" className="absolute inset-x-0 top-0 h-56 w-full object-cover" />
        <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-background/10 via-background/60 to-background" />
      </div>

      <div className="px-5 pt-4 relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">{t('hi_user', language, { name: user?.name || 'Farmer' })}</h2>
            <p className="text-sm text-muted-foreground">{t('welcome_back', language)}</p>
          </div>
        </div>

        {/* Live Weather Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-3xl p-5 text-primary-foreground mb-5 relative overflow-hidden shadow-xl border border-white/20"
        >
          {/* Top Bar: Label & Refresh Button */}
          <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase">
              <span className="text-base">🌦️</span>
              <span>{t('live_weather', language)}</span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || weatherLoading}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-foreground/15 hover:bg-primary-foreground/25 transition-all text-xs font-medium backdrop-blur-sm disabled:opacity-50"
              title={t('refresh', language)}
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing || weatherLoading ? 'animate-spin' : ''}`} />
              <span>{t('refresh', language)}</span>
            </button>
          </div>

          {/* Location Line & Search Toggle */}
          <div className="flex items-center justify-between gap-2 text-xs mb-3">
            <div className="flex items-center gap-1.5 opacity-90 truncate">
              <MapPin className="h-4 w-4 shrink-0 text-red-300" />
              <span className="font-semibold text-sm truncate">
                {weatherPhase === 'locating'
                  ? `📍 ${t('getting_location', language)}`
                  : `📍 ${weatherData?.location || t('current_location', language)}`}
              </span>
            </div>
            <button
              onClick={() => setShowSearchModal(true)}
              className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-md bg-white/20 hover:bg-white/30 text-[11px] font-medium transition-colors"
            >
              <Search className="h-3 w-3" />
              <span>{t('search_city', language)}</span>
            </button>
          </div>

          {/* Permission warning banner if denied */}
          {locationPermissionDenied && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-500/20 p-2 text-xs text-amber-100 border border-amber-400/30">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
              <div className="flex-1">
                <span className="font-semibold">{t('location_denied', language)}</span>
                <span className="ml-1 opacity-80">{t('showing_regional', language)}</span>
                <button onClick={() => setShowSearchModal(true)} className="ml-1 underline font-semibold">{t('search_city', language)}</button>
              </div>
            </div>
          )}

          {/* Phase-based loading state */}
          {weatherLoading && !weatherData ? (
            <div className="py-8 text-center space-y-2">
              <div className="flex justify-center">
                <div className="h-10 w-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
              </div>
              <p className="text-sm font-semibold animate-pulse mt-3">
                {weatherPhase === 'locating' ? `📍 ${t('getting_location', language)}` : `🌦️ ${t('fetching_weather', language)}`}
              </p>
              <p className="text-xs opacity-60">
                {weatherPhase === 'locating' ? t('getting_location', language) : t('fetching_weather', language)}
              </p>
            </div>
          ) : weatherError && !weatherData ? (
            /* Error state */
            <div className="py-6 text-center space-y-3 bg-red-950/30 rounded-2xl p-4 border border-red-500/30">
              <div className="text-3xl">⚠️</div>
              <p className="text-sm font-semibold text-red-200">{t('weather_unavailable', language)}</p>
              <p className="text-xs opacity-80">{weatherError}</p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  onClick={handleRefresh}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-xs font-semibold transition-colors"
                >
                  <RefreshCw className="h-3 w-3" /> {t('retry', language)}
                </button>
                <button
                  onClick={() => setShowSearchModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-xs font-semibold transition-colors"
                >
                  <Search className="h-3 w-3" /> {t('search_city', language)}
                </button>
              </div>
            </div>
          ) : (
            /* ── Main Weather Display ── */
            <>
              {/* Temperature + Icon row */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-5xl font-extrabold tracking-tight">{weatherData?.temperature ?? 27}°C</p>
                  <p className="text-base font-medium opacity-90 mt-1 capitalize">{weatherData?.condition || "Cloudy"}</p>
                  {weatherData?.description && weatherData.description !== weatherData.condition?.toLowerCase() && (
                    <p className="text-xs opacity-70 capitalize mt-0.5">{weatherData.description}</p>
                  )}
                </div>
                <div className="text-right">
                  {getWeatherIcon(weatherData?.condition, weatherData?.icon)}
                  {/* Data source badge */}
                  {weatherData?.source && (
                    <span className="mt-1 inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-white/15 opacity-70">
                      {weatherData.source}
                    </span>
                  )}
                </div>
              </div>

              {/* Weather Metrics Grid — 3 columns */}
              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-black/20 p-3 backdrop-blur-md border border-white/10 text-xs mb-3">
                {/* Feels Like */}
                <div className="flex flex-col items-center gap-1 text-center">
                  <Thermometer className="h-4 w-4 opacity-70" />
                  <span className="opacity-65 text-[10px]">{t('feels_like', language)}</span>
                  <span className="font-bold text-sm">{weatherData?.feelsLike ?? weatherData?.feels_like ?? 28}°C</span>
                </div>

                {/* Humidity */}
                <div className="flex flex-col items-center gap-1 text-center">
                  <Droplets className="h-4 w-4 opacity-70" />
                  <span className="opacity-65 text-[10px]">{t('humidity', language)}</span>
                  <span className="font-bold text-sm">{weatherData?.humidity ?? 72}%</span>
                </div>

                {/* Rainfall */}
                <div className="flex flex-col items-center gap-1 text-center">
                  <CloudRain className="h-4 w-4 opacity-70" />
                  <span className="opacity-65 text-[10px]">{t('rainfall', language)}</span>
                  <span className="font-bold text-sm">{weatherData?.rainfall ?? 0} mm</span>
                </div>

                {/* Wind Speed */}
                <div className="flex flex-col items-center gap-1 text-center">
                  <Wind className="h-4 w-4 opacity-70" />
                  <span className="opacity-65 text-[10px]">{t('wind', language)}</span>
                  <span className="font-bold text-sm">{weatherData?.windSpeed ?? weatherData?.wind_speed ?? 3.2} m/s</span>
                </div>

                {/* Pressure */}
                <div className="flex flex-col items-center gap-1 text-center">
                  <Gauge className="h-4 w-4 opacity-70" />
                  <span className="opacity-65 text-[10px]">{t('pressure', language)}</span>
                  <span className="font-bold text-sm">{weatherData?.pressure ?? 1012} hPa</span>
                </div>

                {/* Visibility */}
                <div className="flex flex-col items-center gap-1 text-center">
                  <Eye className="h-4 w-4 opacity-70" />
                  <span className="opacity-65 text-[10px]">{t('visibility', language)}</span>
                  <span className="font-bold text-sm">
                    {weatherData?.visibility != null ? `${weatherData.visibility} km` : '—'}
                  </span>
                </div>
              </div>

              {/* Irrigation Advice Badge */}
              <div className="text-[11px] font-medium bg-emerald-950/40 border border-emerald-400/30 rounded-xl p-2 text-emerald-200 mb-3">
                {irrigationAdvice}
              </div>

              {/* Footer: Last Updated + source */}
              <div className="flex items-center justify-between text-[11px] opacity-65 border-t border-white/10 pt-2">
                <span>🕐 {t('updated', language)}: {lastUpdatedText}</span>
                {weatherData?.lastUpdated && (
                  <span className="text-[10px] opacity-60">
                    {new Date(weatherData.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </>
          )}
        </motion.div>

        {/* Soil expert contact strip */}
        <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-50/80 p-3 dark:bg-emerald-950/30">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 mb-2">{t('contact_soil_expert', language)}</p>
          <div className="flex items-center gap-2">
            <a
              href={`tel:${SOIL_EXPERT_TEL}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 py-2 text-xs font-bold text-white"
            >
              <Phone className="h-3.5 w-3.5" /> {t('call_now', language)}
            </a>
            <a
              href={`https://wa.me/${SOIL_EXPERT_TEL.replace('+', '')}?text=${encodeURIComponent('Hello, I want to know my soil.')}`}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#25D366] py-2 text-xs font-bold text-white"
            >
              <MessageCircle className="h-3.5 w-3.5" /> {t('whatsapp', language)}
            </a>
          </div>
          <p className="mt-2 text-center text-[11px] font-medium text-emerald-700 dark:text-emerald-300">+91 {SOIL_EXPERT_PHONE}</p>
        </div>

        {/* Activity Tiles */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">{t('recent_activity', language)}</h3>
        </div>

        <div className="space-y-3 pb-4">
          {activities.map((a, i) => (
            <motion.button
              key={a.title}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              onClick={() => handleActivityClick(a.link)}
              className="flex w-full items-center gap-4 rounded-2xl bg-card p-4 shadow-card text-left transition-transform active:scale-[0.98]"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                <a.icon className="h-6 w-6 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{a.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.sub}</p>
              </div>
              {a.badge && (
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${a.badgeColor}`}>{a.badge}</span>
              )}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Manual City Search Modal */}
      <AnimatePresence>
        {showSearchModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4"
            onClick={() => setShowSearchModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-3xl bg-card p-5 shadow-elevated border border-border"
            >
              <h3 className="text-lg font-bold text-foreground mb-1">{t('search_city_weather', language)}</h3>
              <p className="text-xs text-muted-foreground mb-4">{t('search_city_hint', language)}</p>

              <form onSubmit={handleSearchSubmit} className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchCity}
                    onChange={e => setSearchCity(e.target.value)}
                    placeholder="e.g. Belagavi, Dharwad, Hubballi..."
                    className="w-full rounded-2xl border-2 border-border bg-background pl-10 pr-4 py-3 text-sm text-foreground focus:border-accent focus:outline-none"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowSearchModal(false)}
                    className="flex-1 rounded-xl border border-border py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
                  >
                    {t('cancel', language)}
                  </button>
                  <button
                    type="submit"
                    disabled={searchLoading || !searchCity.trim()}
                    className="flex-1 rounded-xl bg-accent py-2.5 text-xs font-bold text-accent-foreground disabled:opacity-50 hover:brightness-105"
                  >
                    {searchLoading ? t('searching', language) : t('search', language)}
                  </button>
                </div>
              </form>

              <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('use_browser_gps', language)}</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowSearchModal(false);
                    requestGeolocation();
                  }}
                  className="font-bold text-accent hover:underline flex items-center gap-1"
                >
                  <MapPin className="h-3 w-3" /> {t('use_gps', language)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Know Your Soil form */}
      <AnimatePresence>
        {showSoilForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end justify-center bg-foreground/40 backdrop-blur-sm"
            onClick={() => setShowSoilForm(false)}
          >
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl bg-card p-6 shadow-elevated"
            >
              <h2 className="text-lg font-bold text-foreground mb-1">{t('soil_form_title', language)}</h2>
              <p className="text-xs text-muted-foreground mb-4">{t('soil_form_intro', language)}</p>
              <div className="mb-4 flex items-center gap-2">
                <a href={`tel:${SOIL_EXPERT_TEL}`} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-700 py-2 text-xs font-bold text-white">
                  <Phone className="h-3.5 w-3.5" /> {t('call_now', language)}
                </a>
                <a href={`https://wa.me/${SOIL_EXPERT_TEL.replace('+', '')}`} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#25D366] py-2 text-xs font-bold text-white">
                  <MessageCircle className="h-3.5 w-3.5" /> {t('whatsapp', language)}
                </a>
              </div>
              <p className="mb-3 text-center text-[11px] text-muted-foreground">+91 {SOIL_EXPERT_PHONE}</p>
              <form onSubmit={handleSoilSubmit} className="space-y-3">
                {[
                  { key: 'name', label: t('farmer_name', language), type: 'text' },
                  { key: 'phone', label: t('phone', language), type: 'tel' },
                  { key: 'village', label: t('village', language), type: 'text' },
                  { key: 'district', label: t('district', language).replace('📍 ', ''), type: 'text' },
                  { key: 'landAcres', label: t('land_size', language), type: 'text' },
                  { key: 'crop', label: t('current_crop', language), type: 'text' },
                  { key: 'soilType', label: t('soil_type', language).replace('🌍 ', ''), type: 'text' },
                ].map(field => (
                  <label key={field.key} className="block text-xs font-medium text-foreground">
                    {field.label}
                    <input
                      type={field.type}
                      value={(soilForm as Record<string, string>)[field.key]}
                      onChange={e => setSoilForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    />
                  </label>
                ))}
                <label className="block text-xs font-medium text-foreground">
                  {t('notes', language)}
                  <textarea
                    value={soilForm.notes}
                    onChange={e => setSoilForm(prev => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  />
                </label>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setShowSoilForm(false)} className="flex-1 rounded-xl border border-border py-2.5 text-xs font-semibold">
                    {t('cancel', language)}
                  </button>
                  <button type="submit" disabled={soilSubmitting} className="flex-1 rounded-xl bg-accent py-2.5 text-xs font-bold text-accent-foreground disabled:opacity-50">
                    {soilSubmitting ? t('submitting', language) : t('submit_details', language)}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Language Modal */}
      <AnimatePresence>
        {showLangModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end justify-center bg-foreground/40 backdrop-blur-sm"
            onClick={() => setShowLangModal(false)}
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md rounded-t-3xl bg-card p-6 shadow-elevated"
            >
              <h2 className="text-lg font-bold text-foreground mb-1">{t('choose_language', language)}</h2>
              <p className="text-sm text-muted-foreground mb-5">{t('tap_to_apply', language)}</p>
              <div className="flex flex-col gap-3">
                {languages.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => {
                      setLanguage(lang.code);
                      setShowLangModal(false);
                    }}
                    className={`flex items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left transition-all ${language === lang.code ? "border-accent bg-accent/5" : "border-border bg-background"
                      }`}
                  >
                    <div className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl ${lang.color}`}>
                      <span className="text-base font-bold leading-none">{lang.badge}</span>
                      <span className="text-[9px] font-semibold leading-none mt-0.5 tracking-wide opacity-70">{lang.badgeSub}</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">{lang.native}</p>
                      <p className="text-xs text-muted-foreground">{lang.name}</p>
                    </div>
                    {language === lang.code && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent">
                        <Check className="h-3.5 w-3.5 text-accent-foreground" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MobileLayout>
  );
};

export default Dashboard;
