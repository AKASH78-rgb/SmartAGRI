import React, { useState, useEffect } from "react";
import { cropFertilizerAPI, SoilClimatePayload } from "@/services/api";
import { useApp } from "@/contexts/AppContext";
import { t } from "@/lib/i18n";
import MobileLayout from "@/components/MobileLayout";
import { toast } from "sonner";
import {
  Sprout,
  FlaskConical,
  Sparkles,
  ArrowRight,
  TrendingUp,
  ShieldAlert,
  ShieldCheck,
  Layers,
  MapPin,
  RefreshCw,
  Info,
  Download,
  CalendarDays,
  Droplets,
  Gauge,
  Bug
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import cropFertilizerHero from "/crop-fertilizer.jpg";

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

const getFertilizerImage = (fertilizerType: string, image?: string): string => {
  const fertilizerImages: Record<string, string> = {
    "10-26-26": "/10-26-26.jpg",
    "14-35-14": "/14-35-14.jpg",
    "17-17-17": "/17-17-17.jpg",
    "20-20": "/20-20.jpeg",
    "28-28": "/28-28.jpg",
    "dap": "/DAP.jpg",
    "urea": "/Urea.jpg",
  };
  const normalizedType = fertilizerType.trim().toLowerCase();
  const matchingType = Object.keys(fertilizerImages).find((name) => normalizedType.startsWith(name));
  if (matchingType) return fertilizerImages[matchingType];

  const localFilename = image?.split(/[\\/]/).pop()?.toLowerCase();
  const matchingImage = Object.entries(fertilizerImages).find(([, src]) => src.slice(1).toLowerCase() === localFilename);
  return matchingImage?.[1] || "/Urea.jpg";
};

interface AnalysisResult {
  success: boolean;
  soilClimateInput: SoilClimatePayload;
  coordinatorSynthesis: {
    soilHealthScore: number;
    summary: string;
    insight: string;
    pipelineFlow: Array<{ step: number; name: string; status: string; detail: string }>;
  };
  cropAnalysis: {
    recommendedCrop: string;
    teluguName?: string;
    hindiName?: string;
    emoji: string;
    image?: string;
    category: string;
    season: string;
    growthPeriod: string;
    waterRequirement: string;
    confidence: number;
    matchReason: string;
    alternatives: Array<{
      name: string;
      emoji: string;
      category: string;
      confidence: number;
      season: string;
    }>;
  };
  nutrientAnalysis: {
    current: { n: number; p: number; k: number; ph: number };
    required: { n: number; p: number; k: number; phRange: string };
    status: {
      n: { current: number; target: number; delta: number; status: string; level: string; severity: string; percentOfTarget: number };
      p: { current: number; target: number; delta: number; status: string; level: string; severity: string; percentOfTarget: number };
      k: { current: number; target: number; delta: number; status: string; level: string; severity: string; percentOfTarget: number };
      ph: { value: number; status: string; remedy: string | null };
    };
    deficiencies: string[];
    excesses: string[];
  };
  fertilizerRecommendation: {
    fertilizerType: string;
    image?: string;
    dosage: string;
    dosagePerAcre: {
      urea: string;
      dap: string;
      mop: string;
      micronutrient?: string;
    };
    dosagePerHectare: {
      urea: string;
      dap: string;
      mop: string;
    };
    schedule: Array<{
      stage: string;
      timing: string;
      items: string[];
      purpose: string;
    }>;
    reason: string;
    micronutrients?: string;
  };
  cropCalendar: {
    sowingMonth: string;
    harvestMonth: string;
    totalGrowthDays: number;
    milestones: Array<{ week: number; day: string; event: string; type: string; detail: string }>;
    irrigationSchedule: Array<{ stage: string; frequency: string; note: string }>;
    pestAlerts: Array<{ period: string; pest: string; action: string }>;
  };
}

const downloadFarmPlanPdf = async (result: AnalysisResult) => {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 16;
  const textWidth = pageWidth - margin * 2;
  let y = 20;

  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - margin) {
      pdf.addPage();
      y = 20;
    }
  };

  const addParagraph = (text: string, fontSize = 10) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(text, textWidth) as string[];
    ensureSpace(lines.length * 5 + 2);
    pdf.text(lines, margin, y);
    y += lines.length * 5 + 2;
  };

  const addSection = (title: string) => {
    ensureSpace(13);
    y += 2;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(5, 110, 73);
    pdf.text(title, margin, y);
    y += 7;
    pdf.setTextColor(35, 45, 40);
  };

  const addList = (items: string[]) => {
    items.forEach((item) => addParagraph(`- ${item}`));
  };

  const input = result.soilClimateInput;
  const crop = result.cropAnalysis;
  const nutrients = result.nutrientAnalysis;
  const fertilizer = result.fertilizerRecommendation;
  const calendar = result.cropCalendar;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  pdf.setTextColor(5, 110, 73);
  pdf.text("SmartAgriCare Farm Plan", margin, y);
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(95, 105, 100);
  pdf.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  y += 8;
  pdf.setTextColor(35, 45, 40);

  addSection("Executive summary");
  addParagraph(result.coordinatorSynthesis.summary);
  addParagraph(`Soil health score: ${result.coordinatorSynthesis.soilHealthScore}/100`);
  addParagraph(`Coordinator insight: ${result.coordinatorSynthesis.insight}`);

  addSection("Recommended crop");
  addParagraph(`${crop.recommendedCrop}${crop.teluguName ? ` (${crop.teluguName})` : ""} - ${crop.confidence}% confidence`);
  addParagraph(`Category: ${crop.category} | Season: ${crop.season} | Growth period: ${crop.growthPeriod}`);
  addParagraph(`Water requirement: ${crop.waterRequirement}`);
  addParagraph(`Why this crop: ${crop.matchReason}`);
  if (crop.alternatives.length) {
    addList(crop.alternatives.map((alternative) => `${alternative.name}: ${alternative.confidence}% match, ${alternative.season}`));
  }

  addSection("Soil and climate inputs");
  addParagraph(`NPK (kg/ha): N ${input.n}, P ${input.p}, K ${input.k} | pH ${input.ph}`);
  addParagraph(`Temperature: ${input.temperature} C | Humidity: ${input.humidity}% | Rainfall: ${input.rainfall} mm`);
  addParagraph(`Crop nutrient targets (kg/ha): N ${nutrients.required.n}, P ${nutrients.required.p}, K ${nutrients.required.k} | Ideal pH ${nutrients.required.phRange}`);
  addParagraph(`Deficiencies: ${nutrients.deficiencies.join("; ") || "None reported"}`);
  addParagraph(`Excesses: ${nutrients.excesses.join("; ") || "None reported"}`);

  addSection("Fertilizer recommendation");
  addParagraph(`Formulation: ${fertilizer.fertilizerType}`);
  addParagraph(`Recommended dosage: ${fertilizer.dosage}`);
  addParagraph(`Per acre: Urea ${fertilizer.dosagePerAcre.urea}, DAP ${fertilizer.dosagePerAcre.dap}, MOP ${fertilizer.dosagePerAcre.mop}${fertilizer.dosagePerAcre.micronutrient ? `, Micronutrient ${fertilizer.dosagePerAcre.micronutrient}` : ""}`);
  addParagraph(`Per hectare: Urea ${fertilizer.dosagePerHectare.urea}, DAP ${fertilizer.dosagePerHectare.dap}, MOP ${fertilizer.dosagePerHectare.mop}`);
  addParagraph(`Reason: ${fertilizer.reason}`);
  if (fertilizer.micronutrients) addParagraph(`Micronutrients: ${fertilizer.micronutrients}`);
  fertilizer.schedule.forEach((stage) => {
    addParagraph(`${stage.stage} (${stage.timing}) - ${stage.items.join(", ")}. Purpose: ${stage.purpose}`);
  });

  addSection("Crop calendar");
  addParagraph(`Estimated sowing: ${calendar.sowingMonth} | Estimated harvest: ${calendar.harvestMonth} | Growth duration: ${calendar.totalGrowthDays} days`);
  calendar.milestones.forEach((milestone) => {
    addParagraph(`Day ${milestone.day}: ${milestone.event}. ${milestone.detail}`);
  });

  addSection("Irrigation plan");
  calendar.irrigationSchedule.forEach((stage) => {
    addParagraph(`${stage.stage}: ${stage.frequency}. ${stage.note}`);
  });

  addSection("Pest watch");
  calendar.pestAlerts.forEach((alert) => {
    addParagraph(`${alert.period}: ${alert.pest}. Action: ${alert.action}`);
  });

  pdf.save(`${crop.recommendedCrop.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-farm-plan.pdf`);
};

const CropFertilizerIntelligence = ({ hideLayout = false }: { hideLayout?: boolean }) => {
  const { language, coords, weatherData } = useApp();
  const navigate = useNavigate();

  // Soil & Climate Inputs (Entered ONLY once)
  const [n, setN] = useState<number>(90);
  const [p, setP] = useState<number>(42);
  const [k, setK] = useState<number>(43);
  const [ph, setPh] = useState<number>(6.5);
  const [temperature, setTemperature] = useState<number>(28);
  const [humidity, setHumidity] = useState<number>(70);
  const [rainfall, setRainfall] = useState<number>(950);

  // Track whether climate fields were auto-filled from live weather
  const [weatherSynced, setWeatherSynced] = useState<boolean>(false);

  // Flow state
  const [loading, setLoading] = useState<boolean>(false);
  const [analyzingStep, setAnalyzingStep] = useState<number>(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // ── Auto-fill climate fields from live dashboard weather on mount ──
  useEffect(() => {
    if (weatherData && !weatherSynced) {
      if (weatherData.temperature !== undefined) setTemperature(Math.round(weatherData.temperature));
      if (weatherData.humidity !== undefined) setHumidity(Math.round(weatherData.humidity));
      if (weatherData.rainfall !== undefined) setRainfall(Math.round(weatherData.rainfall));
      setWeatherSynced(true);
    }
  }, [weatherData, weatherSynced]);

  // Re-sync whenever live weather refreshes (every 10 min auto-refresh)
  useEffect(() => {
    if (weatherData && weatherSynced) {
      if (weatherData.temperature !== undefined) setTemperature(Math.round(weatherData.temperature));
      if (weatherData.humidity !== undefined) setHumidity(Math.round(weatherData.humidity));
      if (weatherData.rainfall !== undefined) setRainfall(Math.round(weatherData.rainfall));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherData?.lastUpdated]);

  // Run Collective Intelligence analysis
  const handleAnalyze = async () => {
    setLoading(true);
    setAnalyzingStep(1);

    // Visual stepped simulation for collective agent collaboration
    const stepTimer1 = setTimeout(() => setAnalyzingStep(2), 500);
    const stepTimer2 = setTimeout(() => setAnalyzingStep(3), 1000);

    try {
      const payload: SoilClimatePayload = {
        n,
        p,
        k,
        ph,
        temperature,
        humidity,
        rainfall,
        language
      };
      const response = await cropFertilizerAPI.analyze(payload);
      if (response && response.success) {
        setResult(response);
        toast.success("Collective Intelligence Analysis complete!");
        // Scroll down to results smoothly
        setTimeout(() => {
          const resElement = document.getElementById("ci-results-section");
          if (resElement) resElement.scrollIntoView({ behavior: "smooth" });
        }, 150);
      } else {
        toast.error(response?.error || "Analysis failed");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reach intelligence coordinator");
    } finally {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setLoading(false);
      setAnalyzingStep(0);
    }
  };

  const handleDownloadSummary = async () => {
    if (!result) return;
    try {
      await downloadFarmPlanPdf(result);
      toast.success("Detailed farm plan downloaded.");
    } catch (err) {
      console.error("Failed to generate farm plan PDF:", err);
      toast.error("Could not generate the PDF. Please try again.");
    }
  };

  const content = (
    <div className="space-y-5 pb-24 px-1">
      {/* Hero background */}
      <div className="relative -mx-1">
        <img src={cropFertilizerHero} alt="" className="absolute inset-x-0 top-0 h-40 w-full object-cover" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background/10 via-background/60 to-background" />
      </div>

      <div className="relative z-10">
        {/* Unified Input Card (Enter Once) */}
        <div className="rounded-3xl bg-card border border-border p-5 shadow-card space-y-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-emerald-600" />
              <h2 className="font-bold text-sm text-foreground">{t('soil_climate_input', language)}</h2>
            </div>
            <span className="text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">
              Single Input Form
            </span>
          </div>

          {/* NPK Inputs */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <span>🧪 Soil Nutrients (NPK in kg/ha)</span>
            </h3>

            {/* Nitrogen (N) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{t('nitrogen', language)}</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-500/20">
                  {n} kg/ha
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="250"
                step="5"
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0 (Deficient)</span>
                <span>120 (Medium)</span>
                <span>250 (Rich)</span>
              </div>
            </div>

            {/* Phosphorus (P) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{t('phosphorus', language)}</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-500/20">
                  {p} kg/ha
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="120"
                step="2"
                value={p}
                onChange={(e) => setP(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0 (Low)</span>
                <span>50 (Adequate)</span>
                <span>120 (High)</span>
              </div>
            </div>

            {/* Potassium (K) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{t('potassium', language)}</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-500/20">
                  {k} kg/ha
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="150"
                step="2"
                value={k}
                onChange={(e) => setK(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0 (Low)</span>
                <span>60 (Optimum)</span>
                <span>150 (High)</span>
              </div>
            </div>

            {/* Soil pH */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{t('soil_ph', language)}</span>
                <span className={`font-bold px-2 py-0.5 rounded-md border text-xs ${
                  ph < 6.0
                    ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300"
                    : ph > 7.5
                    ? "bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300"
                    : "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300"
                }`}>
                  pH {ph.toFixed(1)} ({ph < 6.0 ? "Acidic" : ph > 7.5 ? "Alkaline" : "Neutral/Ideal"})
                </span>
              </div>
              <input
                type="range"
                min="4.5"
                max="9.0"
                step="0.1"
                value={ph}
                onChange={(e) => setPh(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>4.5 (Acidic)</span>
                <span>6.5 - 7.0 (Neutral)</span>
                <span>9.0 (Alkaline)</span>
              </div>
            </div>
          </div>

          {/* Run Analysis Button */}
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 py-3.5 px-4 text-center text-sm font-bold text-white shadow-elevated transition-transform active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>
                  {analyzingStep === 1
                    ? "Crop Agent Analyzing Climate..."
                    : analyzingStep === 2
                    ? "Fertilizer Agent Calculating Nutrients..."
                    : "Coordinator Synthesizing Results..."}
                </span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>{t('analyze_now', language)}</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        {/* Collective Intelligence Result Section */}
        <AnimatePresence>
          {result && (
            <motion.div
              id="ci-results-section"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-5"
            >
              {/* Combined results from the crop, soil, fertilizer, and crop-calendar agents */}
              <section className="order-4 rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-50/80 via-card to-teal-50/70 p-5 shadow-card dark:from-emerald-950/30 dark:via-card dark:to-teal-950/20">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-emerald-600" />
                      <h3 className="font-bold text-base text-foreground">Your Farm Plan Summary</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      One view of crop suitability, soil needs, fertilizer, and the growing calendar.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadSummary}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3.5 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                  >
                    <Download className="h-4 w-4" />
                    Download detailed PDF
                  </button>
                </div>

                <p className="mb-4 rounded-2xl border border-emerald-600/15 bg-background/75 p-3 text-sm leading-relaxed text-foreground">
                  {result.coordinatorSynthesis.insight}
                </p>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5 text-emerald-600" /> Soil health
                    </span>
                    <p className="mt-1 text-lg font-extrabold text-foreground">{result.coordinatorSynthesis.soilHealthScore}<span className="text-xs font-semibold text-muted-foreground"> / 100</span></p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Sprout className="h-3.5 w-3.5 text-emerald-600" /> Best crop
                    </span>
                    <p className="mt-1 truncate text-sm font-extrabold text-foreground">{result.cropAnalysis.recommendedCrop}</p>
                    <p className="text-[11px] text-muted-foreground">{result.cropAnalysis.confidence}% match</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      <FlaskConical className="h-3.5 w-3.5 text-indigo-600" /> Fertilizer
                    </span>
                    <p className="mt-1 line-clamp-2 text-sm font-extrabold text-foreground">{result.fertilizerRecommendation.fertilizerType}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      Per acre: Urea {result.fertilizerRecommendation.dosagePerAcre.urea}, DAP {result.fertilizerRecommendation.dosagePerAcre.dap}, MOP {result.fertilizerRecommendation.dosagePerAcre.mop}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5 text-teal-600" /> Crop calendar
                    </span>
                    <p className="mt-1 text-sm font-extrabold text-foreground">{result.cropCalendar.sowingMonth} - {result.cropCalendar.harvestMonth}</p>
                    <p className="text-[11px] text-muted-foreground">{result.cropCalendar.totalGrowthDays} day estimate</p>
                  </div>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Crop fit: {result.cropAnalysis.matchReason}
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3.5">
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-bold text-foreground">
                      <Layers className="h-4 w-4 text-teal-600" /> Soil nutrient check (current / crop target, kg/ha)
                    </h4>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      {(["n", "p", "k"] as const).map((nutrient) => (
                        <div key={nutrient} className="rounded-xl bg-secondary/50 p-2">
                          <span className="font-bold uppercase text-muted-foreground">{nutrient}</span>
                          <p className="font-bold text-foreground">
                            {result.nutrientAnalysis.current[nutrient]} / {result.nutrientAnalysis.required[nutrient]}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {result.nutrientAnalysis.deficiencies.length
                        ? `Priority: ${result.nutrientAnalysis.deficiencies.join("; ")}`
                        : "No nutrient deficiencies reported."}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3.5">
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-bold text-foreground">
                      <Droplets className="h-4 w-4 text-sky-600" /> Field actions from the crop calendar
                    </h4>
                    <p className="text-xs leading-relaxed text-foreground">
                      {result.cropCalendar.milestones[0]?.event}: {result.cropCalendar.milestones[0]?.detail}
                    </p>
                    {result.cropCalendar.irrigationSchedule[1] && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Irrigation: {result.cropCalendar.irrigationSchedule[1].stage} - {result.cropCalendar.irrigationSchedule[1].frequency}.
                      </p>
                    )}
                    {result.cropCalendar.pestAlerts[0] && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                        <Bug className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Watch for {result.cropCalendar.pestAlerts[0].pest} ({result.cropCalendar.pestAlerts[0].period}).
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* 1. RECOMMENDED CROP CARD */}
              <div className="order-1 rounded-3xl bg-card border border-border p-5 shadow-card space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Sprout className="h-5 w-5 text-emerald-600" />
                    <h3 className="font-bold text-sm text-foreground">
                      🌱 {t('recommended_crop', language)}
                    </h3>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Agent 1: Crop Specialist
                  </span>
                </div>

                {/* Crop photo */}
                <div className="overflow-hidden rounded-2xl border border-border">
                  <img
                    src={getCropImage(result.cropAnalysis.recommendedCrop)}
                    alt={result.cropAnalysis.recommendedCrop}
                    loading="lazy"
                    className="h-48 w-full object-cover"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xl font-extrabold text-foreground truncate">
                    {result.cropAnalysis.recommendedCrop}
                  </h4>
                  {result.cropAnalysis.teluguName && (
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      {result.cropAnalysis.teluguName}
                    </span>
                  )}
                </div>

                {/* Confidence Score */}
                <div className="space-y-1.5 rounded-2xl bg-secondary/40 p-3 border border-border/50">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <TrendingUp className="h-4 w-4 text-emerald-600" />
                      <span>{t('confidence_score', language)}</span>
                    </span>
                    <span className="font-extrabold text-sm text-emerald-600 dark:text-emerald-400">
                      {result.cropAnalysis.confidence}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${result.cropAnalysis.confidence}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                    />
                  </div>
                </div>
              </div>

              {/* 2. NUTRIENT GAP ANALYSIS (Current NPK vs Required NPK) */}
              <div className="order-2 rounded-3xl bg-card border border-border p-5 shadow-card space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-teal-600" />
                    <h3 className="font-bold text-sm text-foreground">
                      🧪 {t('nutrient_gaps', language)}
                    </h3>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Agent 2: Soil Chemist
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Current Soil Values */}
                  <div className="rounded-2xl bg-secondary/50 p-3 space-y-1.5 border border-border/60">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground block">
                      {t('current_npk', language)}
                    </span>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">N:</span>
                        <span className="font-bold text-foreground">{result.nutrientAnalysis.current.n} kg/ha</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">P:</span>
                        <span className="font-bold text-foreground">{result.nutrientAnalysis.current.p} kg/ha</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">K:</span>
                        <span className="font-bold text-foreground">{result.nutrientAnalysis.current.k} kg/ha</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">pH:</span>
                        <span className="font-bold text-foreground">{result.nutrientAnalysis.current.ph}</span>
                      </div>
                    </div>
                  </div>

                  {/* Required Nutrients for Selected Crop */}
                  <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-1.5 border border-emerald-500/20">
                    <span className="text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-300 block">
                      {t('required_nutrients', language)}
                    </span>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-emerald-900/70 dark:text-emerald-200/70">N (Target):</span>
                        <span className="font-bold text-emerald-900 dark:text-emerald-200">{result.nutrientAnalysis.required.n} kg/ha</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-900/70 dark:text-emerald-200/70">P (Target):</span>
                        <span className="font-bold text-emerald-900 dark:text-emerald-200">{result.nutrientAnalysis.required.p} kg/ha</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-900/70 dark:text-emerald-200/70">K (Target):</span>
                        <span className="font-bold text-emerald-900 dark:text-emerald-200">{result.nutrientAnalysis.required.k} kg/ha</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-900/70 dark:text-emerald-200/70">pH Range:</span>
                        <span className="font-bold text-emerald-900 dark:text-emerald-200">{result.nutrientAnalysis.required.phRange}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Deficiencies or Excesses Alert Cards */}
                <div className="space-y-2 pt-1">
                  <span className="text-xs font-semibold text-foreground block">
                    ⚠️ Detected Deficits & Excesses:
                  </span>
                  {result.nutrientAnalysis.deficiencies?.length > 0 ? (
                    <div className="space-y-1.5">
                      {result.nutrientAnalysis.deficiencies.map((d, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/40 p-2.5 text-xs text-amber-900 dark:text-amber-200"
                        >
                          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                          <span>{d}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 p-2.5 text-xs text-emerald-900 dark:text-emerald-200">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      <span>No severe deficiencies detected. Soil reserves are well balanced!</span>
                    </div>
                  )}

                  {result.nutrientAnalysis.excesses?.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {result.nutrientAnalysis.excesses.map((e, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-300 dark:border-sky-800/40 p-2.5 text-xs text-sky-900 dark:text-sky-200"
                        >
                          <Info className="h-4 w-4 shrink-0 text-sky-600 mt-0.5" />
                          <span>{e}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 3. FERTILIZER RECOMMENDATION AGENT CARD */}
              <div className="order-3 rounded-3xl bg-card border border-border p-5 shadow-card space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-5 w-5 text-indigo-600" />
                    <h3 className="font-bold text-sm text-foreground">
                      💊 {t('recommended_fertilizer', language)}
                    </h3>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Agent 3: Fertilizer Expert
                  </span>
                </div>

                {/* Fertilizer Image */}
                <div className="relative h-48 w-full overflow-hidden rounded-2xl">
                  <img
                    src={getFertilizerImage(
                      result.fertilizerRecommendation.fertilizerType,
                      result.fertilizerRecommendation.image
                    )}
                    alt={result.fertilizerRecommendation.fertilizerType}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>

                {/* Fertilizer Name */}
                <div className="rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/40 p-3.5 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-300 block">
                    Recommended Fertilizer Formulation:
                  </span>
                  <p className="text-base font-bold text-indigo-950 dark:text-indigo-100">
                    {result.fertilizerRecommendation.fertilizerType}
                  </p>
                </div>

                {/* Find Nearby Stores CTA */}
                <div className="pt-2">
                  <button
                    onClick={() => navigate("/stores?district=Belagavi")}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card border-2 border-emerald-600 py-3 px-4 text-xs font-bold text-emerald-700 dark:text-emerald-300 shadow-sm transition-transform active:scale-[0.98] hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  >
                    <MapPin className="h-4 w-4 text-emerald-600" />
                    <span>Locate Fertilizer Stores Nearby</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </div>
  );

  return hideLayout ? content : <MobileLayout>{content}</MobileLayout>;
};

export default CropFertilizerIntelligence;
