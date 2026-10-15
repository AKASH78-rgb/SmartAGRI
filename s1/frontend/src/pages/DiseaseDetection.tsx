import { useState, useRef, useEffect, useCallback } from "react";
import { diseaseAPI } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useApp } from "@/contexts/AppContext";
import { t } from "@/lib/i18n";
import { speak, stopSpeaking } from "@/lib/tts";
import { useDropzone } from "react-dropzone";
import MobileLayout from "@/components/MobileLayout";
import {
  Camera, Upload, X, ShieldCheck, Info, ChevronDown,
  Volume2, VolumeX, Save, CheckCircle, AlertTriangle, Leaf,
  Pill, ImageOff, Sprout, Bug, Droplets, RefreshCw, Scan,
  FlipHorizontal, ZoomIn
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import diseaseHero from "/crop.jpg";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MedEntry {
  medicine: string;
  quantity_per_acre: string;
  water_volume: string;
  when_to_apply: string;
  repeat: string;
  total_duration: string;
}

interface Result {
  status?: string;
  crop?: string;
  disease: string;
  confidence: number;
  cause: string;
  treatment: string[];
  medication_timeline: MedEntry[];
  max_sprays: string;
  is_viral: boolean;
  viral_note: string;
  stores: string[];
  message?: string;
  deficiencies: string[];
  disorders: string[];
  natural_organic_treatment: string[];
}

type FlowStep = "idle" | "camera" | "preview" | "analyzing" | "result";

// ─── Speaker Button ───────────────────────────────────────────────────────────

const SpeakerButton = ({ text, language }: { text: string; language?: string }) => {
  const [speaking, setSpeaking] = useState(false);
  const toggle = () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); }
    else {
      speak({ text, language: language || "en", onEnd: () => setSpeaking(false), onError: () => setSpeaking(false) });
      setSpeaking(true);
    }
  };
  return (
    <button onClick={toggle}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${speaking ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent/20 hover:text-accent"}`}
      title={speaking ? "Stop" : "Read aloud"}>
      {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </button>
  );
};

// ─── Step Indicator ───────────────────────────────────────────────────────────

const StepIndicator = ({ step }: { step: FlowStep }) => {
  const steps = [
    { id: "idle", label: "Photo", icon: "📸" },
    { id: "preview", label: "Preview", icon: "🖼️" },
    { id: "result", label: "Result", icon: "🔬" },
  ];
  const activeIdx = step === "camera" ? 0 : step === "analyzing" ? 1 : step === "result" ? 2 : step === "preview" ? 1 : 0;

  return (
    <div className="flex items-center justify-center gap-2 mb-5">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
            i < activeIdx ? "bg-accent/20 text-accent" :
            i === activeIdx ? "bg-accent text-accent-foreground" :
            "bg-muted text-muted-foreground"
          }`}>
            <span>{s.icon}</span>
            <span>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-px w-5 rounded-full ${i < activeIdx ? "bg-accent" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const DiseaseDetection = () => {
  const { user } = useAuth();
  const { language } = useApp();

  // ── State ──
  const [flowStep, setFlowStep] = useState<FlowStep>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);  // data URL shown in preview
  const [capturedFile, setCapturedFile] = useState<File | null>(null);      // File sent to backend
  const [result, setResult] = useState<Result | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cameraPermDenied, setCameraPermDenied] = useState(false);

  // ── Refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageUrlRef = useRef<string | null>(null);   // object-URL to revoke
  const isMountedRef = useRef(true);
  const languageRef = useRef(language);
  languageRef.current = language;

  // ── Stop camera stream ──
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      stopStream();
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      stopSpeaking();
    };
  }, [stopStream]);

  // ── Attach stream to <video> when camera step becomes active ──
  useEffect(() => {
    if (flowStep === "camera" && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [flowStep]);

  // ────────────────────────────────────────────────────────────────────────────
  // Step 1 — Open camera
  // ────────────────────────────────────────────────────────────────────────────
  const openCamera = useCallback(async () => {
    setCameraPermDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setFlowStep("camera");
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        setCameraPermDenied(true);
      } else {
        // No camera hardware (desktop) — fall back to file picker
        fileInputRef.current?.click();
      }
    }
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2 — Capture photo from live camera
  // ────────────────────────────────────────────────────────────────────────────
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    canvas.getContext("2d")?.drawImage(video, 0, 0);

    stopStream();   // stop camera immediately — user's privacy

    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], "leaf-capture.jpg", { type: "image/jpeg" });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      setCapturedFile(file);
      setCapturedImage(dataUrl);
      setResult(null);
      setAnalysisError(null);
      setSaved(false);
      setFlowStep("preview");
    }, "image/jpeg", 0.92);
  }, [stopStream]);

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2b — Close camera without capturing
  // ────────────────────────────────────────────────────────────────────────────
  const closeCamera = useCallback(() => {
    stopStream();
    setFlowStep("idle");
  }, [stopStream]);

  // ────────────────────────────────────────────────────────────────────────────
  // Step 3 — Retake photo (go back to camera)
  // ────────────────────────────────────────────────────────────────────────────
  const retakePhoto = useCallback(async () => {
    if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null; }
    setCapturedImage(null);
    setCapturedFile(null);
    setResult(null);
    setAnalysisError(null);
    await openCamera();
  }, [openCamera]);

  // ────────────────────────────────────────────────────────────────────────────
  // Step 4 — Analyze disease
  // ────────────────────────────────────────────────────────────────────────────
  const analyzeDisease = useCallback(async () => {
    if (!capturedFile || flowStep === "analyzing") return;
    setFlowStep("analyzing");
    setAnalysisError(null);

    try {
      const data = await diseaseAPI.detectDisease(capturedFile, languageRef.current);
      if (!isMountedRef.current) return;

      if (data?.status === "unrecognized") {
        setResult({
          status: "unrecognized",
          disease: "Unrecognized",
          confidence: data.confidence <= 1 ? Math.round(data.confidence * 100) : Math.round(data.confidence),
          cause: "", treatment: [], medication_timeline: [], max_sprays: "",
          is_viral: false, viral_note: "", stores: [],
          message: data.message || "Image not recognized as a plant leaf.",
          deficiencies: [], disorders: [], natural_organic_treatment: [],
        });
      } else if (data?.disease) {
        const rawConf = data.confidence ?? 90;
        const confidence = rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf);
        setResult({
          status: data.status || "diseased",
          crop: data.crop || "",
          disease: data.disease,
          confidence,
          cause: data.cause || data.cause_of_disease || "",
          treatment: Array.isArray(data.treatment) ? data.treatment : [data.treatment].filter(Boolean),
          medication_timeline: data.medication_timeline || [],
          max_sprays: data.max_sprays || "",
          is_viral: data.is_viral || false,
          viral_note: data.viral_note || "",
          stores: data.stores || [],
          message: data.message || "",
          deficiencies: data.deficiencies || [],
          disorders: data.disorders || [],
          natural_organic_treatment: data.natural_organic_treatment || [],
        });
      } else {
        const msg = "Could not identify a disease. Try a clearer close-up photo of the affected leaf.";
        setAnalysisError(msg);
        toast.error(msg);
        setFlowStep("preview");   // return to preview so user can retake
        return;
      }
      setFlowStep("result");
    } catch (err: any) {
      if (!isMountedRef.current) return;
      const msg = err?.message?.trim()
        ? String(err.message)
        : "Analysis service unavailable. Please try again.";
      setAnalysisError(msg);
      toast.error(msg);
      setFlowStep("preview");
    }
  }, [capturedFile, flowStep]);

  // ────────────────────────────────────────────────────────────────────────────
  // Upload from gallery / file picker fallback
  // ────────────────────────────────────────────────────────────────────────────
  const processUploadedFile = useCallback((file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("Image too large. Maximum size is 10 MB."); return; }
    const dataUrl = URL.createObjectURL(file);
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = dataUrl;
    setCapturedImage(dataUrl);
    setCapturedFile(file);
    setResult(null);
    setAnalysisError(null);
    setSaved(false);
    setFlowStep("preview");
  }, []);

  const onDrop = useCallback((files: File[]) => { if (files[0]) processUploadedFile(files[0]); }, [processUploadedFile]);
  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { "image/*": [] }, maxFiles: 1, noClick: true });

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) processUploadedFile(e.target.files[0]);
    e.target.value = "";
  };

  // ── Reset everything ──
  const resetAll = useCallback(() => {
    stopStream();
    stopSpeaking();
    if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null; }
    setCapturedImage(null);
    setCapturedFile(null);
    setResult(null);
    setAnalysisError(null);
    setSaved(false);
    setCameraPermDenied(false);
    setFlowStep("idle");
  }, [stopStream]);

  // ── Save report ──
  const saveReport = async () => {
    if (!result || saving) return;
    setSaving(true);
    try {
      const res = await diseaseAPI.saveReport({
        userId: user?.id ? parseInt(user.id) : 0,
        disease: result.disease,
        confidence: result.confidence,
        cause: result.cause,
        treatment: result.treatment,
        stores: result.stores,
      });
      if (res?.success) { setSaved(true); toast.success(t("report_saved", language)); }
      else toast.error("Failed to save report");
    } catch { toast.error("Failed to save report"); }
    setSaving(false);
  };

  const toggle = (s: string) => setOpenSections(prev => {
    const next = new Set(prev);
    next.has(s) ? next.delete(s) : next.add(s);
    return next;
  });

  const isHealthy = result?.status === "healthy";
  const isUnrecognized = result?.status === "unrecognized";

  // ── Result sections (accordions) ──
  const sections = result && !isHealthy && !isUnrecognized ? [
    ...(result.is_viral ? [{ key: "viral", icon: AlertTriangle, title: t("viral_warning", language), speakText: result.viral_note, content: <p className="text-sm text-orange-400 font-medium">{result.viral_note}</p> }] : []),
    { key: "cause", icon: Info, title: t("cause_of_disease", language), speakText: result.cause, content: <div>{result.crop && <p className="text-xs font-medium text-accent mb-1">{result.crop}</p>}<p className="text-sm text-muted-foreground">{result.cause}</p></div> },
    ...(result.deficiencies.length > 0 ? [{ key: "deficiencies", icon: Droplets, title: t("deficiencies", language), speakText: result.deficiencies.join(". "), content: <ul className="list-disc pl-4 space-y-1.5 text-sm text-muted-foreground">{result.deficiencies.map((d, i) => <li key={i}>{d}</li>)}</ul> }] : []),
    ...(result.disorders.length > 0 ? [{ key: "disorders", icon: Bug, title: t("disorders", language), speakText: result.disorders.join(". "), content: <ul className="list-disc pl-4 space-y-1.5 text-sm text-muted-foreground">{result.disorders.map((d, i) => <li key={i}>{d}</li>)}</ul> }] : []),
    { key: "treatment", icon: ShieldCheck, title: t("chemical_treatment", language), speakText: result.treatment.join(". "), content: <ol className="list-decimal pl-4 space-y-1 text-sm text-muted-foreground">{result.treatment.map((s, i) => <li key={i}>{s}</li>)}</ol> },
    ...(result.natural_organic_treatment.length > 0 ? [{ key: "organic", icon: Sprout, title: t("organic_treatment", language), speakText: result.natural_organic_treatment.join(". "), content: <ol className="list-decimal pl-4 space-y-1.5 text-sm text-muted-foreground">{result.natural_organic_treatment.map((s, i) => <li key={i}>{s}</li>)}</ol> }] : []),
    ...(result.medication_timeline.length > 0 ? [{
      key: "medication", icon: Pill, title: t("medication_schedule", language),
      speakText: result.medication_timeline.map(m => `${m.medicine}, ${m.quantity_per_acre} per acre, ${m.when_to_apply}`).join(". "),
      content: (
        <div className="space-y-3">
          {result.medication_timeline.map((m, i) => (
            <div key={i} className="rounded-xl bg-primary-foreground/5 border border-border/50 p-3 space-y-1.5">
              <p className="text-sm font-semibold text-foreground">{m.medicine}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{t("quantity", language)}: <span className="text-foreground">{m.quantity_per_acre}</span></span>
                <span>{t("water", language)}: <span className="text-foreground">{m.water_volume}</span></span>
                <span>{t("when", language)}: <span className="text-foreground">{m.when_to_apply}</span></span>
                <span>{t("repeat", language)}: <span className="text-foreground">{m.repeat}</span></span>
              </div>
              <p className="text-xs text-muted-foreground">{t("duration", language)}: <span className="text-foreground">{m.total_duration}</span></p>
            </div>
          ))}
          {result.max_sprays && <p className="text-xs text-muted-foreground pt-1">{t("max_sprays", language)}: <span className="font-medium text-foreground">{result.max_sprays}</span></p>}
        </div>
      ),
    }] : []),
  ] : [];

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <MobileLayout>
      {/* Hero background */}
      <div className="relative">
        <img src={diseaseHero} alt="" className="absolute inset-x-0 top-0 h-48 w-full object-cover" />
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-background/10 via-background/60 to-background" />
      </div>

      {/* ── Hidden elements ── */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
      <canvas ref={canvasRef} className="hidden" />

      {/* ── Full-screen Camera Viewfinder ── */}
      <AnimatePresence>
        {flowStep === "camera" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col"
          >
            {/* Video preview */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="flex-1 w-full object-cover"
            />

            {/* Leaf framing overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="border-2 border-white/60 rounded-2xl w-64 h-64 relative">
                {/* Corner accents */}
                {["-top-1 -left-1","- top-1 -right-1","-bottom-1 -left-1","-bottom-1 -right-1"].map((pos,i) => (
                  <div key={i} className={`absolute w-5 h-5 border-white border-2 rounded-sm ${["rounded-br-none rounded-bl-none rounded-tr-none","rounded-bl-none rounded-br-none rounded-tl-none","rounded-tr-none rounded-tl-none rounded-br-none","rounded-tl-none rounded-tr-none rounded-bl-none"][i]}`} style={{[["top","top","bottom","bottom"][i]]:"-2px",[["left","right","left","right"][i]]:"-2px"}} />
                ))}
                <p className="absolute -bottom-8 left-0 right-0 text-center text-white/80 text-xs font-medium">
                  🌿 Align the leaf in the frame
                </p>
              </div>
            </div>

            {/* Top bar */}
            <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-12 pb-4 bg-gradient-to-b from-black/70 to-transparent">
              <button onClick={closeCamera} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white">
                <X className="h-5 w-5" />
              </button>
              <p className="text-white text-sm font-semibold">Plant Disease Scanner</p>
              <div className="w-10" />
            </div>

            {/* Bottom controls */}
            <div className="absolute bottom-0 inset-x-0 flex flex-col items-center pb-12 pt-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent gap-4">
              {/* Capture button */}
              <button
                onClick={capturePhoto}
                className="flex h-20 w-20 items-center justify-center rounded-full border-[5px] border-white bg-white/20 backdrop-blur-sm active:scale-90 transition-transform"
              >
                <div className="h-14 w-14 rounded-full bg-white" />
              </button>

              {/* Upload fallback */}
              <button
                onClick={() => { stopStream(); setFlowStep("idle"); fileInputRef.current?.click(); }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/20 backdrop-blur-sm text-white text-xs font-medium"
              >
                <Upload className="h-3.5 w-3.5" /> Upload from gallery
              </button>

              <p className="text-white/50 text-[11px]">Tap the circle to capture</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Page content ── */}
      <div className="px-5 pt-4 relative z-10 pb-24">
        <h1 className="text-xl font-bold text-foreground mb-0.5">{t("disease_detection", language)}</h1>
        <p className="text-sm text-muted-foreground mb-4">{t("upload_diagnose", language)}</p>

        {/* Step indicator */}
        {flowStep !== "idle" && <StepIndicator step={flowStep} />}

        {/* ══════════════════════════════════════════════════════════════
            STEP: IDLE — Take Photo / Upload
        ══════════════════════════════════════════════════════════════ */}
        <AnimatePresence mode="wait">
          {flowStep === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">

              {/* Camera permission denied banner */}
              {cameraPermDenied && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700/50 p-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Camera access required</p>
                    <p className="text-xs mt-1 text-amber-700/90 dark:text-amber-400/80">
                      Camera access is required to capture a plant leaf image. Please allow camera permission in your browser settings.
                    </p>
                    <button onClick={() => fileInputRef.current?.click()} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 underline">
                      <Upload className="h-3 w-3" /> Upload image instead
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Take Photo — primary CTA */}
              <button
                onClick={openCamera}
                className="flex w-full items-center gap-4 rounded-2xl bg-gradient-to-r from-accent to-accent/80 p-5 shadow-lg transition-transform active:scale-[0.98]"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                  <Camera className="h-7 w-7 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-bold text-white text-base">Take Photo</p>
                  <p className="text-xs text-white/80 mt-0.5">Open rear camera to capture plant leaf</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                  <Scan className="h-4 w-4 text-white" />
                </div>
              </button>

              {/* Upload from gallery */}
              <div {...getRootProps()}>
                <input {...getInputProps()} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-4 rounded-2xl bg-card p-5 shadow-card transition-transform active:scale-[0.98] border border-border"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
                    <Upload className="h-6 w-6 text-accent" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-foreground">{t("upload_gallery", language)}</p>
                    <p className="text-xs text-muted-foreground">{t("browse_files", language)}</p>
                  </div>
                </button>
              </div>

              {/* Tips */}
              <div className="rounded-2xl bg-primary/5 border border-primary/10 p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-foreground">For best results</p>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                      <li>Close-up of the <strong>affected leaf only</strong></li>
                      <li>Good natural lighting — avoid shadows or flash</li>
                      <li>Supported crops: <strong>Tomato, Potato, Bell Pepper</strong></li>
                      <li>Max 10 MB · JPG or PNG</li>
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              STEP: PREVIEW — Show captured image + Retake / Analyze
          ══════════════════════════════════════════════════════════════ */}
          {flowStep === "preview" && capturedImage && (
            <motion.div key="preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

              {/* Captured image */}
              <div className="relative overflow-hidden rounded-2xl border-2 border-accent/30 shadow-lg">
                <img src={capturedImage} alt="Captured leaf" className="w-full aspect-square object-cover" />
                <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-1 text-xs text-white font-medium">
                  <ZoomIn className="h-3 w-3" /> Preview
                </div>
                <button onClick={resetAll} className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Error from previous attempt */}
              {analysisError && (
                <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />
                  <p className="text-xs text-red-700 dark:text-red-400">{analysisError}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={retakePhoto}
                  className="flex items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card py-4 text-sm font-semibold text-foreground active:scale-[0.97] transition-transform"
                >
                  <FlipHorizontal className="h-4 w-4" /> Retake Photo
                </button>
                <button
                  onClick={analyzeDisease}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-accent to-accent/80 py-4 text-sm font-bold text-accent-foreground shadow-lg active:scale-[0.97] transition-transform"
                >
                  <Scan className="h-4 w-4" /> Analyze Disease
                </button>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                📸 Image looks good? Tap <strong>Analyze Disease</strong> to detect.
              </p>
            </motion.div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              STEP: ANALYZING — Loading state
          ══════════════════════════════════════════════════════════════ */}
          {flowStep === "analyzing" && (
            <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              {/* Dim image with spinner */}
              {capturedImage && (
                <div className="relative overflow-hidden rounded-2xl">
                  <img src={capturedImage} alt="Analyzing" className="w-full aspect-square object-cover opacity-50" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-foreground/20 backdrop-blur-sm">
                    <div className="h-14 w-14 animate-spin rounded-full border-4 border-accent border-t-transparent" />
                    <div className="text-center space-y-1">
                      <p className="text-sm font-bold text-white">Analyzing Plant Leaf...</p>
                      <p className="text-xs text-white/70">AI model processing image</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step-by-step progress pills */}
              <div className="space-y-2">
                {[
                  { label: "Processing image", done: true },
                  { label: "Detecting disease", done: true },
                  { label: "Generating prediction", done: false },
                ].map((s, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.3 }}
                    className="flex items-center gap-3 rounded-xl bg-card border border-border p-3"
                  >
                    {s.done ? (
                      <CheckCircle className="h-4 w-4 text-accent shrink-0" />
                    ) : (
                      <RefreshCw className="h-4 w-4 text-accent animate-spin shrink-0" />
                    )}
                    <span className="text-sm font-medium text-foreground">{s.label}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              STEP: RESULT
          ══════════════════════════════════════════════════════════════ */}
          {flowStep === "result" && result && (
            <motion.div key="result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

              {/* Captured image thumbnail */}
              {capturedImage && (
                <div className="overflow-hidden rounded-2xl border border-border shadow">
                  <img src={capturedImage} alt="Analyzed leaf" className="w-full h-44 object-cover" />
                </div>
              )}

              {/* ── Healthy ── */}
              {isHealthy && (
                <div className="rounded-2xl bg-green-500/10 border border-green-500/30 p-5 text-center space-y-3">
                  <Leaf className="h-12 w-12 text-green-500 mx-auto" />
                  <div>
                    <p className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-1">Plant Status</p>
                    <h2 className="text-xl font-bold text-green-600">🌿 {result.crop ? `${result.crop} — ` : ""}Healthy</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{result.message || t("no_disease_detected", language)}</p>
                  <div className="inline-flex items-center gap-2 rounded-full bg-green-500/20 px-4 py-1.5">
                    <span className="text-xs text-muted-foreground">Confidence:</span>
                    <span className="text-sm font-bold text-green-600">{result.confidence}%</span>
                  </div>
                </div>
              )}

              {/* ── Unrecognized ── */}
              {isUnrecognized && (
                <div className="rounded-2xl bg-orange-500/10 border border-orange-500/30 p-5 text-center space-y-3">
                  <ImageOff className="h-12 w-12 text-orange-500 mx-auto" />
                  <div>
                    <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-1">Unable to identify</p>
                    <h2 className="text-lg font-bold text-orange-600">Unable to confidently identify the disease.</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{result.message || "Please capture a clearer image of the affected leaf."}</p>
                  <div className="inline-flex items-center gap-2 rounded-full bg-orange-500/20 px-4 py-1.5">
                    <span className="text-xs text-muted-foreground">Confidence:</span>
                    <span className="text-sm font-bold text-orange-600">{result.confidence}%</span>
                  </div>
                </div>
              )}

              {/* ── Diseased ── */}
              {!isHealthy && !isUnrecognized && (
                <>
                  {/* Header result card */}
                  <div className="rounded-2xl bg-card border border-border p-5 space-y-3 shadow-card">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-red-500/15 text-red-600 dark:text-red-400 px-3 py-0.5 text-xs font-semibold">Disease Detected</span>
                      {/* Confidence ring */}
                      <div className="relative h-14 w-14">
                        <svg className="h-14 w-14 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-muted" />
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-accent"
                            strokeDasharray={`${result.confidence} ${100 - result.confidence}`} strokeLinecap="round" />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">{result.confidence}%</span>
                      </div>
                    </div>
                    {result.crop && <p className="text-xs font-medium text-accent">{result.crop}</p>}
                    <h2 className="text-lg font-bold text-foreground">🌿 {result.disease}</h2>
                    <p className="text-xs text-muted-foreground">Confidence: <span className="font-semibold text-foreground">{result.confidence}%</span></p>
                  </div>

                  {/* Accordion sections */}
                  {sections.map(section => (
                    <div key={section.key} className="rounded-2xl bg-card shadow-card overflow-hidden">
                      <div className="flex w-full items-center gap-3 p-4">
                        <section.icon className={`h-5 w-5 shrink-0 ${section.key === "viral" ? "text-orange-400" : "text-accent"}`} />
                        <button onClick={() => toggle(section.key)} className="flex flex-1 items-center text-left">
                          <span className={`flex-1 text-sm font-semibold ${section.key === "viral" ? "text-orange-400" : "text-foreground"}`}>{section.title}</span>
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform mr-2 ${openSections.has(section.key) ? "rotate-180" : ""}`} />
                        </button>
                        <SpeakerButton text={section.speakText} language={language} />
                      </div>
                      <AnimatePresence>
                        {openSections.has(section.key) && (
                          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                            <div className="px-4 pb-4">{section.content}</div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-1">
                {!isHealthy && !isUnrecognized && (
                  <button
                    onClick={saveReport}
                    disabled={saving || saved}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-all ${saved ? "border-accent bg-accent/10 text-accent" : "border-border text-foreground"}`}
                  >
                    {saved ? <><CheckCircle className="h-4 w-4" /> Saved</> : saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" /> : <><Save className="h-4 w-4" /> {t("save_report", language)}</>}
                  </button>
                )}
                <button
                  onClick={resetAll}
                  className="flex-1 rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground flex items-center justify-center gap-2"
                >
                  <Camera className="h-4 w-4" /> {t("scan_another", language)}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MobileLayout>
  );
};

export default DiseaseDetection;
