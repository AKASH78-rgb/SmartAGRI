import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { voiceAPI } from "@/services/api";
import { useApp } from "@/contexts/AppContext";
import { t } from "@/lib/i18n";
import { speak, stopSpeaking, cleanForTts, getTtsSpeed, setTtsSpeed, TtsSpeed } from "@/lib/tts";
import { findOfflineAnswer } from "@/lib/offlineFaq";
import MobileLayout from "@/components/MobileLayout";
import {
  Mic, MicOff, Volume2, VolumeX, Send, User, Bot, Keyboard, X,
  Share2, Settings2, ChevronDown, ChevronUp, Wifi, WifiOff,
  TrendingUp, Navigation, History, Trash2, UserCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  offline?: boolean;        // Feature #5: marked if answered offline
  followUps?: string[];     // Feature #6: smart follow-up chips
  marketData?: MarketData;  // Feature #3: embedded market price card
}

interface MarketData {
  crop: string;
  msp: number;
  unit: string;
  season: string;
}

interface FarmerProfile {               // Feature #9
  crop: string;
  soil: string;
  district: string;
  landAcres: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const quickPrompts = [
  { en: "What is the weather today?", hi: "आज मौसम कैसा है?", te: "ఈ రోజు వాతావరణం ఎలా ఉంది?" },
  { en: "Should I irrigate my crop today?", hi: "क्या मुझे आज फसल की सिंचाई करनी चाहिए?", te: "నేను ఈ రోజు నా పంటకు నీరు పెట్టాలా?" },
  { en: "What crops should I plant this season?", hi: "इस सीजन में कौन सी फसल लगाऊं?", te: "ఈ సీజన్‌లో ఏ పంట వేయాలి?" },
  { en: "How to treat leaf blight?", hi: "लीफ ब्लाइट का इलाज कैसे करें?", te: "లీఫ్ బ్లైట్ చికిత్స ఎలా?" },
];

// Feature #7 — voice command shortcuts
const VOICE_SHORTCUTS: { triggers: string[]; action: string; route?: string; label: string }[] = [
  { triggers: ['check weather', 'weather', 'मौसम देखो', 'వాతావరణం'], action: 'navigate', route: '/dashboard', label: 'Dashboard' },
  { triggers: ['scan crop', 'detect disease', 'scan my crop', 'फसल स्कैन', 'పంట స్కాన్'], action: 'navigate', route: '/disease-detection', label: 'Disease Detection' },
  { triggers: ['find store', 'fertilizer shop', 'दुकान खोजो', 'దుకాణం కనుగొను'], action: 'navigate', route: '/stores', label: 'Stores' },
  { triggers: ['crop recommendation', 'recommend crop', 'फसल सिफारिश', 'పంట సిఫార్సు'], action: 'navigate', route: '/crop-recommendation', label: 'Crop Recommendation' },
  { triggers: ['market price', 'price of rice', 'price of wheat', 'price of cotton', 'मंडी भाव', 'ధర చెప్పు'], action: 'market', label: 'Market Price' },
  { triggers: ['clear chat', 'new chat', 'reset', 'चैट साफ', 'చాట్ క్లియర్'], action: 'clear', label: 'Clear Chat' },
];

// Feature #6 — follow-up chip map (keyword → chips)
function generateFollowUps(responseText: string, language: string): string[] {
  const text = responseText.toLowerCase();
  type LangKey = 'en' | 'hi' | 'te' | 'kn' | 'mr';

  interface ChipSet { en: string[]; hi: string[]; te: string[]; kn: string[]; mr: string[] }

  let chips: ChipSet = { en: [], hi: [], te: [], kn: [], mr: [] };

  if (text.includes('irrigat') || text.includes('water') || text.includes('सिंचाई') || text.includes('నీరు') || text.includes('ನೀರು') || text.includes('पाणी')) {
    chips = {
      en: ['How much water does it need?', 'Best irrigation method?', 'Signs of overwatering?'],
      hi: ['कितना पानी चाहिए?', 'सबसे अच्छी सिंचाई विधि?', 'अधिक पानी के लक्षण?'],
      te: ['ఎంత నీరు కావాలి?', 'ఉత్తమ నీటిపారుదల పద్ధతి?', 'అధిక నీరు వేసిన సంకేతాలు?'],
      kn: ['ಎಷ್ಟು ನೀರು ಬೇಕು?', 'ಉತ್ತಮ ನೀರಾವರಿ ವಿಧಾನ?', 'ಹೆಚ್ಚು ನೀರಿನ ಲಕ್ಷಣಗಳು?'],
      mr: ['किती पाणी लागते?', 'सर्वोत्तम सिंचन पद्धत?', 'जास्त पाण्याची लक्षणे?'],
    };
  } else if (text.includes('disease') || text.includes('blight') || text.includes('रोग') || text.includes('వ్యాధి') || text.includes('ರೋಗ') || text.includes('रोग')) {
    chips = {
      en: ['How to prevent it?', 'Best organic treatment?', 'Show nearby stores'],
      hi: ['इसे कैसे रोकें?', 'सबसे अच्छा जैविक उपचार?', 'नजदीकी दुकान दिखाएं'],
      te: ['ఎలా నివారించాలి?', 'ఉత్తమ సేంద్రీయ చికిత్స?', 'దగ్గరలో దుకాణం చూపించు'],
      kn: ['ಹೇಗೆ ತಡೆಯಬಹುದು?', 'ಉತ್ತಮ ಜೈವಿಕ ಚಿಕಿತ್ಸೆ?', 'ಹತ್ತಿರದ ಅಂಗಡಿ ತೋರಿಸಿ'],
      mr: ['हे कसे रोखावे?', 'सर्वोत्तम सेंद्रिय उपचार?', 'जवळील दुकान दाखवा'],
    };
  } else if (text.includes('fertiliz') || text.includes('npk') || text.includes('उर्वरक') || text.includes('ఎరువు') || text.includes('ಗೊಬ್ಬರ') || text.includes('खते')) {
    chips = {
      en: ['When to apply?', 'How much per acre?', 'Organic alternatives?'],
      hi: ['कब डालें?', 'प्रति एकड़ कितना?', 'जैविक विकल्प?'],
      te: ['ఎప్పుడు వేయాలి?', 'ఎకరానికి ఎంత?', 'సేంద్రీయ ప్రత్యామ్నాయాలు?'],
      kn: ['ಯಾವಾಗ ಹಾಕಬೇಕು?', 'ಎಕರೆಗೆ ಎಷ್ಟು?', 'ಜೈವಿಕ ಪರ್ಯಾಯಗಳು?'],
      mr: ['कधी घालावे?', 'एकरी किती?', 'सेंद्रिय पर्याय?'],
    };
  } else if (text.includes('crop') || text.includes('फसल') || text.includes('పంట') || text.includes('ಬೆಳೆ') || text.includes('पीक')) {
    chips = {
      en: ['Best season to grow?', 'Water requirement?', 'Market price?'],
      hi: ['उगाने का सबसे अच्छा समय?', 'पानी की जरूरत?', 'बाज़ार भाव?'],
      te: ['పెంచడానికి ఉత్తమ సీజన్?', 'నీటి అవసరం?', 'మార్కెట్ ధర?'],
      kn: ['ಬೆಳೆಯಲು ಉತ್ತಮ ಋತು?', 'ನೀರಿನ ಅವಶ್ಯಕತೆ?', 'ಮಾರುಕಟ್ಟೆ ಬೆಲೆ?'],
      mr: ['पिकवण्याचा सर्वोत्तम हंगाम?', 'पाण्याची गरज?', 'बाजार भाव?'],
    };
  } else if (text.includes('weather') || text.includes('मौसम') || text.includes('వాతావరణం') || text.includes('ಹವಾಮಾನ') || text.includes('हवामान')) {
    chips = {
      en: ['Should I irrigate today?', 'Risk of crop damage?', 'Forecast this week?'],
      hi: ['क्या आज सिंचाई करूं?', 'फसल नुकसान का खतरा?', 'इस हफ्ते का पूर्वानुमान?'],
      te: ['నేడు నీరు పెట్టాలా?', 'పంట నష్టం ఉంటుందా?', 'ఈ వారం అంచనా?'],
      kn: ['ಇಂದು ನೀರು ಹಾಕಬೇಕೇ?', 'ಬೆಳೆ ಹಾನಿ ಅಪಾಯ?', 'ಈ ವಾರ ಮುನ್ಸೂಚನೆ?'],
      mr: ['आज सिंचन करावे का?', 'पिकाच्या नुकसानाचा धोका?', 'या आठवड्याचा अंदाज?'],
    };
  }

  const lang = language as LangKey;
  return (chips[lang] || chips.en).slice(0, 3);
}

// ─── Market price detection ───────────────────────────────────────────────────
const MARKET_TRIGGER_WORDS = ['price of', 'rate of', 'msp', 'market price', 'भाव', 'ధర', 'मंडी', 'మార్కెట్'];
const CROP_NAMES = ['rice', 'wheat', 'cotton', 'groundnut', 'maize', 'tur', 'moong', 'urad', 'chickpea', 'mustard', 'sugarcane', 'sesame', 'jowar', 'bajra', 'ragi', 'soybean', 'जौ', 'गेहूं', 'धान', 'कपास', 'మొక్కజొన్న', 'వరి', 'పత్తి'];

function detectMarketQuery(text: string): string | null {
  const lower = text.toLowerCase();
  const hasMarketTrigger = MARKET_TRIGGER_WORDS.some(w => lower.includes(w));
  if (!hasMarketTrigger) return null;
  return CROP_NAMES.find(c => lower.includes(c)) || null;
}

// ─── Component ────────────────────────────────────────────────────────────────

const VoiceAssistant = () => {
  const { language, weatherData } = useApp();
  const navigate = useNavigate();

  // Core chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);    // Feature #5

  // Feature #9 — farmer profile
  const [farmerProfile, setFarmerProfile] = useState<FarmerProfile>(() => {
    try {
      const stored = localStorage.getItem('smartagricare_voice_profile');
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return { crop: '', soil: '', district: '', landAcres: '' };
  });
  const [showProfile, setShowProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState<FarmerProfile>(farmerProfile);

  // Feature #10 — TTS speed
  const [ttsSpeed, setTtsSpeedState] = useState<TtsSpeed>(getTtsSpeed);
  const [showSettings, setShowSettings] = useState(false);

  // Refs
  const recognitionRef = useRef<any>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isSpeakingRef = useRef(false);
  const micCooldownRef = useRef(false);
  const msgIdCounter = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const nextId = () => `msg-${Date.now()}-${++msgIdCounter.current}`;

  // Feature #5 — online/offline detection
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); toast.success('Back online'); };
    const handleOffline = () => { setIsOnline(false); toast.warning('You are offline — using local answers'); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // TTS
  const speakText = useCallback((text: string) => {
    stopSpeaking();
    isSpeakingRef.current = true;
    speak({
      text: cleanForTts(text),
      language,
      onEnd: () => { isSpeakingRef.current = false; },
      onError: () => { isSpeakingRef.current = false; },
    });
  }, [language]);

  // Feature #10 — persist speed & update TTS
  const handleSpeedChange = useCallback((speed: TtsSpeed) => {
    setTtsSpeed(speed);
    setTtsSpeedState(speed);
    toast.success(`Speed: ${speed}`);
  }, []);

  // Feature #9 — save profile
  const saveProfile = useCallback(() => {
    setFarmerProfile(profileDraft);
    try { localStorage.setItem('smartagricare_voice_profile', JSON.stringify(profileDraft)); } catch { /* ignore */ }
    setShowProfile(false);
    toast.success(t('voice_profile_saved', language as any));
  }, [profileDraft, language]);

  // Feature #4 — auto-save history to backend
  const saveHistoryDebounced = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveHistoryToBackend = useCallback((msgs: Message[]) => {
    if (saveHistoryDebounced.current) clearTimeout(saveHistoryDebounced.current);
    saveHistoryDebounced.current = setTimeout(() => {
      if (msgs.length > 0) {
        voiceAPI.saveHistory(msgs.map(m => ({ role: m.role, text: m.text, timestamp: m.timestamp }))).catch(() => {/* silent */});
      }
    }, 3000);
  }, []);

  // Feature #7 — handle voice shortcuts
  const handleShortcut = useCallback((query: string): boolean => {
    const lower = query.toLowerCase();
    for (const sc of VOICE_SHORTCUTS) {
      if (sc.triggers.some(tr => lower.includes(tr.toLowerCase()))) {
        if (sc.action === 'navigate' && sc.route) {
          const userMsg: Message = { id: nextId(), role: 'user', text: query, timestamp: Date.now() };
          const botMsg: Message = {
            id: nextId(), role: 'assistant', timestamp: Date.now(),
            text: `Navigating to ${sc.label}…`,
          };
          setMessages(prev => [...prev, userMsg, botMsg]);
          setTimeout(() => navigate(sc.route!), 800);
          return true;
        }
        if (sc.action === 'clear') {
          setMessages([]);
          toast.success('Chat cleared');
          return true;
        }
      }
    }
    return false;
  }, [navigate]);

  // Feature #3 — fetch market price and embed card
  const fetchMarketPrice = useCallback(async (cropName: string): Promise<MarketData | null> => {
    try {
      const data = await voiceAPI.getMarketPrice(cropName);
      if (data.success) return { crop: data.crop, msp: data.msp, unit: data.unit, season: data.season };
    } catch { /* ignore */ }
    return null;
  }, []);

  // Core query handler
  const handleQuery = useCallback(async (query: string) => {
    if (!query.trim()) return;
    stopSpeaking();
    isSpeakingRef.current = false;

    // Feature #7 — check shortcuts first
    if (handleShortcut(query)) return;

    const userMsg: Message = { id: nextId(), role: 'user', text: query, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setProcessing(true);

    try {
      let responseText = '';
      let offline = false;
      let marketData: MarketData | undefined;

      // Feature #3 — detect market price query
      const marketCrop = detectMarketQuery(query);
      if (marketCrop && isOnline) {
        const md = await fetchMarketPrice(marketCrop);
        if (md) {
          marketData = md;
          responseText = `${t('voice_msp', language as any)} for ${md.crop} is ₹${md.msp} ${md.unit} (${md.season}).`;
        }
      }

      // Feature #5 — offline fallback
      if (!responseText && !isOnline) {
        const offlineAnswer = findOfflineAnswer(query, language);
        if (offlineAnswer) {
          responseText = offlineAnswer;
          offline = true;
        } else {
          responseText = language === 'hi'
            ? 'इंटरनेट नहीं है। कृपया ऑनलाइन होने पर पूछें।'
            : language === 'te'
            ? 'ఇంటర్నెట్ లేదు. దయచేసి ఆన్‌లైన్‌లో అడగండి.'
            : language === 'kn'
            ? 'ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ. ದಯವಿಟ್ಟು ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಕೇಳಿ.'
            : language === 'mr'
            ? 'इंटरनेट नाही. कृपया ऑनलाइन असताना विचारा.'
            : 'You are offline. Please reconnect to get an AI answer.';
          offline = true;
        }
      }

      // Online AI query
      if (!responseText) {
        const history = [...messagesRef.current, userMsg].map(m => ({ role: m.role, content: m.text }));
        const profile = (farmerProfile.crop || farmerProfile.soil || farmerProfile.district)
          ? farmerProfile : null;
        const data = await voiceAPI.processQuery(query, language, history, weatherData, profile);
        responseText = data?.response || "I couldn't process that request. Please try again.";
      }

      // Feature #6 — generate follow-up chips
      const followUps = offline ? [] : generateFollowUps(responseText, language);

      const botMsg: Message = {
        id: nextId(),
        role: 'assistant',
        text: responseText,
        timestamp: Date.now(),
        offline,
        followUps: followUps.length > 0 ? followUps : undefined,
        marketData,
      };

      setMessages(prev => {
        const updated = [...prev, botMsg];
        saveHistoryToBackend(updated);
        return updated;
      });

      if (autoSpeak) setTimeout(() => speakText(responseText), 150);
    } catch {
      const fallback = language === 'hi'
        ? 'माफ करें, कोई त्रुटि हुई। पुनः प्रयास करें।'
        : language === 'te'
        ? 'క్షమించండి, లోపం జరిగింది. మళ్ళీ ప్రయత్నించండి.'
        : language === 'kn'
        ? 'ಕ್ಷಮಿಸಿ, ದೋಷ ಉಂಟಾಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.'
        : language === 'mr'
        ? 'माफ करा, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.'
        : 'Sorry, I encountered an error. Please try again.';
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', text: fallback, timestamp: Date.now() }]);
      if (autoSpeak) setTimeout(() => speakText(fallback), 150);
    }
    setProcessing(false);
  }, [language, autoSpeak, speakText, weatherData, farmerProfile, isOnline, handleShortcut, fetchMarketPrice, saveHistoryToBackend]);

  const handleQueryRef = useRef(handleQuery);
  handleQueryRef.current = handleQuery;

  // Speech recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      const langMap: Record<string, string> = { en: "en-US", hi: "hi-IN", te: "te-IN", kn: "kn-IN", mr: "mr-IN" };
      rec.lang = langMap[language] || "en-US";
      rec.onresult = (e: any) => {
        const transcript = e.results[0]?.[0]?.transcript;
        if (transcript) handleQueryRef.current(transcript);
        setListening(false);
      };
      rec.onerror = (e: any) => {
        console.warn("Speech recognition error:", e.error);
        setListening(false);
        if (e.error === 'not-allowed') {
          toast.error("Microphone permission denied.");
          setShowTextInput(true);
        }
      };
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
    } else {
      setSpeechSupported(false);
      setShowTextInput(true);
    }
    return () => { recognitionRef.current?.abort?.(); stopSpeaking(); };
  }, [language]);

  // Auto-scroll
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, processing]);

  const toggleListening = useCallback(() => {
    if (micCooldownRef.current) return;
    micCooldownRef.current = true;
    setTimeout(() => { micCooldownRef.current = false; }, 500);
    if (!recognitionRef.current) { setShowTextInput(true); return; }
    if (listening) { recognitionRef.current.stop(); setListening(false); return; }
    stopSpeaking();
    isSpeakingRef.current = false;
    setTimeout(() => {
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        setTimeout(() => {
          try { recognitionRef.current.start(); setListening(true); }
          catch { toast.error("Could not start microphone."); setShowTextInput(true); }
        }, 300);
      }
    }, 100);
  }, [listening]);

  const handleTextSubmit = useCallback(() => {
    if (!textInput.trim()) return;
    handleQuery(textInput.trim());
    setTextInput("");
  }, [textInput, handleQuery]);

  // Feature #8 — share message
  const shareMessage = useCallback((text: string) => {
    const shareText = `SmartAgriCare AI Advice:\n\n${text}\n\nPowered by SmartAgriCare`;
    if (navigator.share) {
      navigator.share({ title: 'SmartAgriCare Advice', text: shareText }).catch(() => {/* ignore */});
    } else {
      navigator.clipboard?.writeText(shareText).then(() => toast.success(t('voice_copied', language as any)));
    }
  }, [language]);

  // Feature #4 — clear chat
  const clearChat = useCallback(() => {
    setMessages([]);
    toast.success(t('voice_clear', language as any));
  }, [language]);

  const hasProfile = farmerProfile.crop || farmerProfile.soil || farmerProfile.district;

  return (
    <MobileLayout>
      <div className="flex flex-col h-[calc(100dvh-80px)]">

        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div>
                <h1 className="text-xl font-bold text-foreground">{t('voice_assistant', language as any)}</h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xs text-muted-foreground">{t('ask_anything', language as any)}</p>
                  {/* Feature #5 — offline badge */}
                  {!isOnline && (
                    <span className="flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">
                      <WifiOff className="h-2.5 w-2.5" /> Offline
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Feature #9 — profile button */}
              <button
                onClick={() => { setProfileDraft(farmerProfile); setShowProfile(!showProfile); setShowSettings(false); }}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${hasProfile ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground'}`}
                title="Farm Profile"
              >
                <UserCircle2 className="h-4 w-4" />
              </button>

              {/* Feature #10 — settings */}
              <button
                onClick={() => { setShowSettings(!showSettings); setShowProfile(false); }}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${showSettings ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground'}`}
                title="Settings"
              >
                <Settings2 className="h-4 w-4" />
              </button>

              {/* TTS toggle */}
              <button
                onClick={() => setAutoSpeak(!autoSpeak)}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${autoSpeak ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground"}`}
                title={autoSpeak ? "Auto-TTS On" : "Auto-TTS Off"}
              >
                {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>

              {/* Feature #4 — clear history */}
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  title={t('voice_clear', language as any)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Feature #9 — profile panel */}
          <AnimatePresence>
            {showProfile && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 rounded-2xl bg-card shadow-card p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">{t('voice_profile_title', language as any)}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['crop', 'soil', 'district', 'landAcres'] as (keyof FarmerProfile)[]).map((field) => (
                      <div key={field}>
                        <label className="text-[10px] text-muted-foreground capitalize">
                          {t(`voice_profile_${field}`, language as any)}
                        </label>
                        <input
                          value={profileDraft[field]}
                          onChange={e => setProfileDraft(prev => ({ ...prev, [field]: e.target.value }))}
                          placeholder={field === 'crop' ? 'e.g. Rice' : field === 'soil' ? 'e.g. Black Cotton' : field === 'district' ? 'e.g. Guntur' : 'e.g. 5'}
                          className="w-full mt-0.5 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={saveProfile}
                    className="w-full rounded-xl bg-primary text-primary-foreground py-2 text-xs font-medium"
                  >
                    {t('voice_profile_save', language as any)}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Feature #10 — settings panel */}
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 rounded-2xl bg-card shadow-card p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">{t('voice_tts_speed', language as any)}</p>
                  <div className="flex gap-2">
                    {(['slow', 'normal', 'fast'] as TtsSpeed[]).map(s => (
                      <button
                        key={s}
                        onClick={() => handleSpeedChange(s)}
                        className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors capitalize ${ttsSpeed === s ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Feature #9 — active profile badge */}
          {hasProfile && !showProfile && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-accent bg-accent/10 rounded-full px-3 py-1 w-fit">
              <UserCircle2 className="h-3 w-3" />
              {[farmerProfile.crop, farmerProfile.district].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        {/* ── Messages ── */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-5 space-y-3 pb-4">
          {messages.length === 0 && !processing && (
            <div className="pt-6 space-y-3">
              <p className="text-center text-sm text-muted-foreground mb-4">Try asking:</p>
              {quickPrompts.map((p, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  onClick={() => handleQuery(p[language as keyof typeof p] || p.en)}
                  className="w-full text-left rounded-2xl bg-card p-4 shadow-card text-sm text-foreground active:scale-[0.98] transition-transform"
                >
                  {p[language as keyof typeof p] || p.en}
                </motion.button>
              ))}
            </div>
          )}

          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {m.role === "assistant" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 mt-1">
                  <Bot className="h-4 w-4 text-accent" />
                </div>
              )}

              <div className={`max-w-[82%] space-y-2`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card text-foreground shadow-card rounded-bl-sm"}`}
                >
                  {/* Feature #5 — offline badge */}
                  {m.offline && (
                    <span className="mb-1.5 flex items-center gap-1 text-[10px] text-amber-600">
                      <WifiOff className="h-2.5 w-2.5" /> {t('voice_offline_badge', language as any)}
                    </span>
                  )}

                  {m.text}

                  {/* Feature #3 — market price card */}
                  {m.marketData && (
                    <div className="mt-3 rounded-xl bg-accent/10 border border-accent/20 p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <TrendingUp className="h-3.5 w-3.5 text-accent" />
                        <span className="text-xs font-semibold text-accent">{t('voice_msp', language as any)}</span>
                      </div>
                      <p className="text-sm font-bold text-foreground">₹{m.marketData.msp.toLocaleString('en-IN')}</p>
                      <p className="text-xs text-muted-foreground">{m.marketData.unit} · {m.marketData.season}</p>
                    </div>
                  )}

                  {m.role === "assistant" && (
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={() => speakText(m.text)}
                        className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 active:scale-95 py-1"
                      >
                        <Volume2 className="h-3.5 w-3.5" /> {t('listen', language as any)}
                      </button>
                      {/* Feature #8 — share */}
                      <button
                        onClick={() => shareMessage(m.text)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground active:scale-95 py-1"
                      >
                        <Share2 className="h-3 w-3" /> {t('voice_share', language as any)}
                      </button>
                    </div>
                  )}
                </div>

                {/* Feature #6 — follow-up chips */}
                {m.role === 'assistant' && m.followUps && m.followUps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {m.followUps.map((chip, ci) => (
                      <motion.button
                        key={ci}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: ci * 0.06 }}
                        onClick={() => handleQuery(chip)}
                        className="rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] px-3 py-1 active:scale-95 transition-transform"
                      >
                        {chip}
                      </motion.button>
                    ))}
                  </div>
                )}
              </div>

              {m.role === "user" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-1">
                  <User className="h-4 w-4 text-primary" />
                </div>
              )}
            </motion.div>
          ))}

          {processing && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10">
                <Bot className="h-4 w-4 text-accent" />
              </div>
              <div className="rounded-2xl bg-card px-4 py-3 shadow-card">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Input area ── */}
        <div className="px-5 pb-5 border-t border-border bg-background">

          {/* Feature #7 — quick navigation shortcuts */}
          {messages.length === 0 && (
            <div className="pt-3 pb-1 flex gap-2 overflow-x-auto no-scrollbar">
              {[
                { label: '🌡️ Weather', route: '/dashboard' },
                { label: '🔍 Scan', route: '/disease-detection' },
                { label: '🏪 Stores', route: '/stores' },
                { label: '🌾 Crops', route: '/crop-recommendation' },
              ].map((item) => (
                <button
                  key={item.route}
                  onClick={() => navigate(item.route)}
                  className="shrink-0 rounded-full bg-muted text-muted-foreground text-xs px-3 py-1.5 flex items-center gap-1 active:scale-95 transition-transform"
                >
                  <Navigation className="h-2.5 w-2.5" /> {item.label}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence>
            {showTextInput && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 pt-3">
                  <input
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleTextSubmit()}
                    placeholder={t('type_message', language as any)}
                    className="flex-1 rounded-xl border border-border bg-card py-3 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    onClick={handleTextSubmit}
                    disabled={!textInput.trim() || processing}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-center gap-4 pt-3">
            {speechSupported && (
              <button
                onClick={() => setShowTextInput(!showTextInput)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                {showTextInput ? <X className="h-4 w-4" /> : <Keyboard className="h-4 w-4" />}
              </button>
            )}

            <button
              onClick={toggleListening}
              disabled={processing}
              className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-all active:scale-95 ${
                listening
                  ? "bg-destructive text-destructive-foreground animate-pulse"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {listening ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
            </button>

            {speechSupported && <div className="w-10" />}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-2">
            {listening
              ? t('listening', language as any)
              : speechSupported
              ? t('tap_to_speak', language as any)
              : t('type_message', language as any)}
          </p>
        </div>
      </div>
    </MobileLayout>
  );
};

export default VoiceAssistant;
