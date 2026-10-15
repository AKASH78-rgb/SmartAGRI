import React, { useState, useEffect } from "react";
import { cropAPI, type CropRecommendationHistoryItem } from "@/services/api";
import { useApp } from "@/contexts/AppContext";
import { t, type Language } from "@/lib/i18n";
import MobileLayout from "@/components/MobileLayout";
import { toast } from "sonner";
import { Maximize2, Clock, TrendingUp, Droplets, Check, ChevronDown, Leaf, Sprout, MapPin, FlaskConical, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import cropHero from "/crops-grow.jpg";

// Crop image mapping - only crops that have images in the image/crops folder
const getCropImage = (cropName: string): string => {
  const cropImages: Record<string, string> = {
    "Rice": "/rice.jpg",
    "Paddy": "/rice.jpg",
    "Cotton": "/cotton.jpg",
    "Maize": "/maize.jpg",
    "Corn": "/maize.jpg",
    "Apple": "/apple.jpg",
    "Banana": "/banana.jpg",
    "Blackgram": "/blackgram.jpg",
    "Chickpea": "/chickpea.jpg",
    "Coconut": "/coconut.jpg",
    "Coffee": "/coffee.jpg",
    "Grapes": "/grapes.jpg",
    "Jute": "/jute.jpg",
    "Kidneybeans": "/kidneybeans.jpg",
    "Lentil": "/lentil.jpg",
    "Mango": "/mango.jpg",
    "Mothbeans": "/mothbeans.jpg",
    "Mungbean": "/mungbean.jpg",
    "Muskmelon": "/muskmelon.jpg",
    "Orange": "/orange.jpg",
    "Papaya": "/papaya.jpg",
    "Pigeonpeas": "/pigeonpeas.jpg",
    "Pomegranate": "/pomegranate.jpg",
    "Watermelon": "/watermelon.jpg",
  };
  return cropImages[cropName] || "/crop.jpg";
};

// Default AP soils — IDs stay English (sent to backend), labels are i18n keys
const soilDefs = [
  { id: "Red", i18nLabel: "soil_red", emoji: "🟤", i18nDesc: "soil_red_desc" },
  { id: "Black Cotton", i18nLabel: "soil_black_cotton", emoji: "⬛", i18nDesc: "soil_black_cotton_desc" },
  { id: "Alluvial", i18nLabel: "soil_alluvial", emoji: "🟡", i18nDesc: "soil_alluvial_desc" },
  { id: "Laterite", i18nLabel: "soil_laterite", emoji: "🧱", i18nDesc: "soil_laterite_desc" },
  { id: "Sandy", i18nLabel: "soil_sandy", emoji: "🏜️", i18nDesc: "soil_sandy_desc" },
  { id: "Coastal Saline", i18nLabel: "soil_coastal_saline", emoji: "🌊", i18nDesc: "soil_coastal_saline_desc" },
  { id: "Clay", i18nLabel: "soil_clay", emoji: "🏔️", i18nDesc: "soil_clay_desc" },
];

const seasonDefs = [
  { id: "Kharif", i18nLabel: "season_kharif", emoji: "☀️", i18nDesc: "season_kharif_desc" },
  { id: "Rabi", i18nLabel: "season_rabi", emoji: "❄️", i18nDesc: "season_rabi_desc" },
  { id: "Zaid", i18nLabel: "season_zaid", emoji: "🌸", i18nDesc: "season_zaid_desc" },
];

const waterDefs = [
  { id: "Low", i18nLabel: "water_low", emoji: "💧" },
  { id: "Moderate", i18nLabel: "water_moderate", emoji: "💧💧" },
  { id: "High", i18nLabel: "water_high", emoji: "💧💧💧" },
];

interface CropResult {
  name: string; match: number; period: string; water: string; yield: string;
  sowing?: string; harvest?: string; fertilizer?: string; emoji?: string;
  districts?: string[]; varieties?: string[];
  intercrops?: string[]; phRange?: string; rainfall?: string;
}

const CropCardSkeleton = () => (
  <div className="rounded-2xl bg-card shadow-card overflow-hidden animate-pulse">
    <div className="h-24 bg-muted flex items-center justify-center">
      <div className="h-10 w-10 rounded-full bg-muted-foreground/10" />
    </div>
    <div className="p-3 space-y-2">
      <div className="h-3 w-3/4 rounded bg-muted" />
      <div className="h-3 w-1/2 rounded bg-muted" />
      <div className="h-3 w-2/3 rounded bg-muted" />
    </div>
  </div>
);

const CropCard = React.memo(({ crop, index, language, onSelect }: {
  crop: CropResult; index: number; language: Language; onSelect: (c: CropResult) => void;
}) => {
  return (
    <motion.button initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}
      onClick={() => onSelect(crop)}
      className="rounded-2xl bg-card shadow-card overflow-hidden text-left">
      <div className="relative h-24 overflow-hidden bg-gradient-to-br from-green-500/20 via-emerald-500/10 to-teal-500/20 flex items-center justify-center">
        <img src={getCropImage(crop.name)} alt={crop.name} className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <span className="relative text-5xl drop-shadow-sm">{crop.emoji || '🌱'}</span>
        <span className="absolute top-2 right-2 rounded-full bg-accent/90 px-2 py-0.5 text-[10px] font-bold text-accent-foreground">{crop.match}%</span>
        <h3 className="absolute bottom-2 left-2 right-2 text-sm font-bold text-foreground leading-tight drop-shadow-sm">{crop.name}</h3>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3 w-3 shrink-0" />{crop.period}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Droplets className="h-3 w-3 shrink-0" />{crop.water} {t('water_label', language)}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="h-3 w-3 shrink-0" />{crop.yield}</div>
      </div>
    </motion.button>
  );
});

const CropRecommendation = () => {
  const { language } = useApp();
  const [soil, setSoil] = useState("");
  const [season, setSeason] = useState("");
  const [water, setWater] = useState("");
  const [district, setDistrict] = useState("");
  const [land, setLand] = useState("2");
  const [results, setResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [crops, setCrops] = useState<CropResult[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [showDistrictPicker, setShowDistrictPicker] = useState(false);
  const [selectedCrop, setSelectedCrop] = useState<CropResult | null>(null);
  const [history, setHistory] = useState<CropRecommendationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchHistory = async () => {
    const token = localStorage.getItem('smartagricare_token');
    if (!token) return;
    setHistoryLoading(true);
    try {
      const data = await cropAPI.getHistory();
      if (data?.success && Array.isArray(data.history)) {
        setHistory(data.history);
      }
    } catch {
      // History fetch failed — ignore (e.g. not authenticated)
    }
    setHistoryLoading(false);
  };

  // Fetch districts and history from backend on mount
  useEffect(() => {
    cropAPI.getMeta().then(data => {
      if (data?.districts) setDistricts(data.districts);
    }).catch(() => { });
    fetchHistory();
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    setResults(true);
    setCrops([]);
    try {
      const data = await cropAPI.getRecommendations(season, soil, water, district, land);
      if (data?.crops?.length) {
        setCrops(data.crops.map((c: any) => ({
          name: c.name, match: c.match ?? 85, period: c.period || '90-120 days',
          water: c.water || water, yield: c.yield || '20-30 q/ha',
          sowing: c.sowing, harvest: c.harvest, fertilizer: c.fertilizer,
          emoji: c.emoji, districts: c.districts,
          varieties: c.varieties, intercrops: c.intercrops,
          phRange: c.phRange, rainfall: c.rainfall,
        })));
      } else {
        setCrops([]);
      }
      // Refresh history after saving the new recommendation
      fetchHistory();
    } catch {
      setCrops([]);
      toast.error("Failed to get crop recommendations. Please check your connection.");
    }
    setLoading(false);
  };

  const handleSelectCrop = (crop: CropResult) => {
    setSelectedCrop(crop);
  };

  return (
    <MobileLayout>
      {/* Hero background */}
      <div className="relative">
        <img src={cropHero} alt="" className="absolute inset-x-0 top-0 h-48 w-full object-cover" />
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-background/10 via-background/60 to-background" />
      </div>

      <div className="px-5 pt-4 relative z-10 pb-4">
        <h1 className="text-xl font-bold text-foreground mb-1">{t('crop_recommendation', language)}</h1>
        <p className="text-sm text-muted-foreground mb-5">{t('get_ai_suggestions', language)}</p>

        <AnimatePresence mode="wait">
          {!results ? (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">

              {/* District Selector */}
              <div>
                <p className="text-sm font-semibold text-foreground mb-3">{t('district', language)}</p>
                <button
                  onClick={() => setShowDistrictPicker(true)}
                  className={`w-full flex items-center justify-between rounded-xl border-2 px-4 py-3.5 text-left transition-all ${district ? "border-accent bg-accent/5" : "border-border bg-card"}`}
                >
                  <span className={district ? "text-foreground font-medium" : "text-muted-foreground"}>
                    {district || t('select_district', language)}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              {/* Soil Type */}
              <div>
                <p className="text-sm font-semibold text-foreground mb-3">{t('soil_type', language)}</p>
                <div className="grid grid-cols-3 gap-2">
                  {soilDefs.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSoil(s.id)}
                      className={`relative flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 transition-all ${soil === s.id ? "border-accent bg-accent/10" : "border-border bg-card"}`}
                    >
                      {soil === s.id && (
                        <div className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-accent flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-accent-foreground" />
                        </div>
                      )}
                      <span className="text-2xl">{s.emoji}</span>
                      <span className={`text-xs font-semibold ${soil === s.id ? "text-accent" : "text-foreground"}`}>{t(s.i18nLabel, language)}</span>
                      <span className="text-[10px] text-muted-foreground text-center leading-tight">{t(s.i18nDesc, language)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Season */}
              <div>
                <p className="text-sm font-semibold text-foreground mb-3">{t('growing_season', language)}</p>
                <div className="grid grid-cols-3 gap-2">
                  {seasonDefs.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSeason(s.id)}
                      className={`relative flex flex-col items-center gap-1.5 rounded-2xl border-2 p-4 transition-all ${season === s.id ? "border-accent bg-accent/10" : "border-border bg-card"}`}
                    >
                      {season === s.id && (
                        <div className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-accent flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-accent-foreground" />
                        </div>
                      )}
                      <span className="text-3xl">{s.emoji}</span>
                      <span className={`text-xs font-semibold ${season === s.id ? "text-accent" : "text-foreground"}`}>{t(s.i18nLabel, language)}</span>
                      <span className="text-[10px] text-muted-foreground">{t(s.i18nDesc, language)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Water Availability */}
              <div>
                <p className="text-sm font-semibold text-foreground mb-3">{t('water_availability', language)}</p>
                <div className="grid grid-cols-3 gap-2">
                  {waterDefs.map(w => (
                    <button
                      key={w.id}
                      onClick={() => setWater(w.id)}
                      className={`relative flex flex-col items-center gap-1.5 rounded-2xl border-2 p-4 transition-all ${water === w.id ? "border-accent bg-accent/10" : "border-border bg-card"}`}
                    >
                      {water === w.id && (
                        <div className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-accent flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-accent-foreground" />
                        </div>
                      )}
                      <span className="text-2xl">{w.emoji}</span>
                      <span className={`text-xs font-semibold ${water === w.id ? "text-accent" : "text-foreground"}`}>{t(w.i18nLabel, language)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Land Size */}
              <div>
                <p className="text-sm font-semibold text-foreground mb-3">{t('acres_of_land', language)}</p>
                <div className="relative">
                  <Maximize2 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="number"
                    value={land}
                    onChange={e => setLand(e.target.value)}
                    min="0.5"
                    step="0.5"
                    placeholder="Acres of Land"
                    className="w-full rounded-xl border border-border bg-card py-3.5 pl-11 pr-16 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{t('acres', language)}</span>
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={!soil || !season || !water || loading}
                className="w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground disabled:opacity-50 transition-transform active:scale-[0.98]"
              >
                {loading ? (
                  <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                ) : t('get_recommendations', language)}
              </button>
            </motion.div>
          ) : (
            <motion.div key="results" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-foreground">{t('recommended_crops', language)} ({crops.length})</h2>
                <button onClick={() => { setResults(false); setSelectedCrop(null); }} className="text-xs text-accent font-medium">{t('modify', language)}</button>
              </div>

              {loading ? (
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map(i => <CropCardSkeleton key={i} />)}
                </div>
              ) : crops.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Leaf className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">{t('no_crops_found', language)}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {crops.map((crop, i) => (
                    <CropCard key={crop.name} crop={crop} index={i} language={language} onSelect={handleSelectCrop} />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* District Picker Modal */}
      <AnimatePresence>
        {showDistrictPicker && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm"
            onClick={() => setShowDistrictPicker(false)}
          >
            <motion.div
              initial={{ y: 200, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 200, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md max-h-[70vh] rounded-t-3xl bg-card p-6 shadow-elevated overflow-hidden flex flex-col"
            >
              <h2 className="text-lg font-bold text-foreground mb-1">{t('select_district', language)}</h2>
              <p className="text-sm text-muted-foreground mb-4">{t('ap_districts', language)}</p>
              <div className="overflow-y-auto flex-1 space-y-1">
                {districts.map(d => (
                  <button
                    key={d}
                    onClick={() => { setDistrict(d); setShowDistrictPicker(false); }}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all ${district === d ? "bg-accent/10 text-accent font-semibold" : "text-foreground hover:bg-muted"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Crop Detail Modal */}
      <AnimatePresence>
        {selectedCrop && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm"
            onClick={() => setSelectedCrop(null)}
          >
            <motion.div
              initial={{ y: 200, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 200, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md max-h-[85vh] rounded-t-3xl bg-card shadow-elevated overflow-hidden flex flex-col"
            >
              {/* Crop hero */}
              <div className="relative h-36 w-full shrink-0 bg-gradient-to-br from-green-500/20 via-emerald-500/10 to-teal-500/20 flex items-center justify-center overflow-hidden">
                <img src={getCropImage(selectedCrop.name)} alt={selectedCrop.name} className="absolute inset-0 h-full w-full object-cover opacity-40" />
                <span className="relative text-7xl drop-shadow-sm">{selectedCrop.emoji || '🌱'}</span>
                <div className="absolute bottom-3 left-4 right-4 relative z-10">
                  <h2 className="text-xl font-bold text-foreground drop-shadow-sm">{selectedCrop.name}</h2>
                  <span className="inline-block mt-1 rounded-full bg-accent/90 px-2.5 py-0.5 text-xs font-bold text-accent-foreground">{selectedCrop.match}% {t('match', language)}</span>
                </div>
              </div>

              <div className="overflow-y-auto flex-1 p-6 pt-4 space-y-3">
                {/* Core growing info */}
                {selectedCrop.sowing && <DetailRow label={t('sowing_window', language)} value={selectedCrop.sowing} />}
                {selectedCrop.harvest && <DetailRow label={t('harvest', language)} value={selectedCrop.harvest} />}
                <DetailRow label={t('growing_period', language)} value={selectedCrop.period} />
                <DetailRow label={t('water_requirement', language)} value={selectedCrop.water} />
                <DetailRow label={t('expected_yield', language)} value={selectedCrop.yield} />
                {selectedCrop.fertilizer && <DetailRow label={t('fertilizer', language)} value={selectedCrop.fertilizer} />}


                {/* pH & Rainfall */}
                {(selectedCrop.phRange || selectedCrop.rainfall) && (
                  <div className="flex gap-4 text-sm">
                    {selectedCrop.phRange && (
                      <div className="flex items-center gap-1.5">
                        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">pH:</span>
                        <span className="font-medium text-foreground">{selectedCrop.phRange}</span>
                      </div>
                    )}
                    {selectedCrop.rainfall && (
                      <div className="flex items-center gap-1.5">
                        <Droplets className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-foreground text-xs">{selectedCrop.rainfall}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Recommended Varieties */}
                {selectedCrop.varieties && selectedCrop.varieties.length > 0 && (
                  <div className="text-sm">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Sprout className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground font-medium">{t('recommended_varieties', language)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCrop.varieties.map(v => (
                        <span key={v} className="rounded-full bg-accent/10 border border-accent/20 px-2.5 py-0.5 text-xs text-foreground">{v}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Intercropping suggestions */}
                {selectedCrop.intercrops && selectedCrop.intercrops.length > 0 && (
                  <div className="text-sm">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Leaf className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground font-medium">{t('intercropping', language)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCrop.intercrops.map(ic => (
                        <span key={ic} className="rounded-full bg-green-500/10 border border-green-500/20 px-2.5 py-0.5 text-xs text-foreground">{ic}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Best districts */}
                {selectedCrop.districts && selectedCrop.districts.length > 0 && (
                  <div className="text-sm">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground font-medium">{t('best_districts', language)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCrop.districts.slice(0, 8).map(d => (
                        <span key={d} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{d}</span>
                      ))}
                      {selectedCrop.districts.length > 8 && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">+{selectedCrop.districts.length - 8} {t('more', language)}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 pt-2 shrink-0">
                <button onClick={() => setSelectedCrop(null)} className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground active:scale-[0.98] transition-transform">{t('close', language)}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* My Recommendations History */}
      {history.length > 0 && (
        <section className="px-4 pb-6 pt-2">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">My Recommendations</h2>
            <span className="text-xs text-muted-foreground">({history.length})</span>
          </div>
          <div className="space-y-2.5">
            {history.map((h) => {
              const dt = new Date(h.createdAt);
              const dateStr = isNaN(dt.getTime()) ? String(h.createdAt) : dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
              return (
                <div key={h.id} className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-lg leading-none">{h.results?.[0]?.emoji || '🌱'}</span>
                        <span className="font-semibold text-foreground truncate">{h.topCrop || '—'}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{h.season}</span>
                        {h.soil && <span>• {h.soil}</span>}
                        {h.district && <span>• {h.district}</span>}
                        {h.land && <span>• {h.land} ac</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-primary">{h.topMatch}%</div>
                      <div className="text-[10px] text-muted-foreground">{dateStr}</div>
                    </div>
                  </div>
                  {h.results && h.results.length > 1 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border pt-2">
                      {h.results.slice(0, 5).map((r, i) => (
                        <span key={`${h.id}-${i}`} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                          {r.emoji || ''} {r.name} {r.match}%
                        </span>
                      ))}
                      {h.results.length > 5 && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">+{h.results.length - 5}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {historyLoading && history.length === 0 && (
        <div className="px-4 pb-6 pt-2 text-center text-sm text-muted-foreground">Loading your recommendations…</div>
      )}
    </MobileLayout>
  );
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right max-w-[55%]">{value}</span>
    </div>
  );
}

export default CropRecommendation;
