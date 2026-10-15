/**
 * Shared TTS (Text-to-Speech) utility with proper voice selection.
 * Handles async voice loading and explicit language-to-voice matching.
 * Falls back to Google Translate TTS for languages with no native voice.
 *
 * Supported: English (en), Hindi (hi), Telugu (te), Kannada (kn), Marathi (mr)
 */

// BCP-47 lang codes for Web Speech API
const LANG_MAP: Record<string, string> = {
  en: "en-US",
  hi: "hi-IN",
  te: "te-IN",
  kn: "kn-IN",
  mr: "mr-IN",
};

// Google Translate TTS lang codes
const GTTS_LANG: Record<string, string> = {
  en: "en",
  hi: "hi",
  te: "te",
  kn: "kn",
  mr: "mr",
};

// Languages that almost never have a native browser voice — always use gTTS
const ALWAYS_USE_GTTS = new Set(["te", "kn", "mr"]);

let cachedVoices: SpeechSynthesisVoice[] = [];
let _gttsFallbackAudio: HTMLAudioElement | null = null;
let _nativeTtsOnEnd: (() => void) | null = null;

// Listen for native TTS completion message from Expo WebView
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?.type === 'NATIVE_TTS_END' || data?.type === 'NATIVE_TTS_DONE') {
        _nativeTtsOnEnd?.();
        _nativeTtsOnEnd = null;
      }
    } catch { /* ignore */ }
  });
}

function loadVoices(): SpeechSynthesisVoice[] {
  if (!window.speechSynthesis) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) cachedVoices = voices;
  return cachedVoices;
}

// Voices load asynchronously in many browsers — listen for the event
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices();
  };
  // Trigger initial load
  loadVoices();
}

function findVoice(langCode: string): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (!voices.length) return null;

  // Exact match first (e.g. "te-IN")
  let match = voices.find(v => v.lang === langCode);
  if (match) return match;

  // Prefix match (e.g. "te" matches "te-IN" or "te")
  const prefix = langCode.split("-")[0];
  match = voices.find(v => v.lang.startsWith(prefix));
  if (match) return match;

  return null;
}

/** Use backend TTS proxy (bypasses CORS) as fallback for languages missing native voices */
function speakWithGTTS(text: string, lang: string, onEnd?: () => void, onError?: (e: any) => void): boolean {
  try {
    // Stop any previous fallback audio
    if (_gttsFallbackAudio) {
      _gttsFallbackAudio.pause();
      _gttsFallbackAudio = null;
    }
    // Backend TTS proxy has a ~500 char limit per request; split into chunks
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= 200) {
        chunks.push(remaining);
        break;
      }
      // Find a good split point (sentence end or space)
      let splitAt = remaining.lastIndexOf('.', 200);
      if (splitAt < 50) splitAt = remaining.lastIndexOf(' ', 200);
      if (splitAt < 50) splitAt = 200;
      chunks.push(remaining.slice(0, splitAt + 1));
      remaining = remaining.slice(splitAt + 1).trimStart();
    }

    const gttsLang = GTTS_LANG[lang] || lang;
    const API_BASE = import.meta.env.VITE_API_URL || '';
    let currentChunk = 0;

    const playNext = () => {
      if (currentChunk >= chunks.length) {
        _gttsFallbackAudio = null;
        onEnd?.();
        return;
      }
      const encoded = encodeURIComponent(chunks[currentChunk]);
      // Use our backend proxy to bypass CORS
      const url = `${API_BASE}/api/tts?lang=${gttsLang}&text=${encoded}`;
      const audio = new Audio(url);
      _gttsFallbackAudio = audio;
      audio.onended = () => { currentChunk++; playNext(); };
      audio.onerror = (e) => { onError?.(e); };
      audio.play().catch(e => onError?.(e));
    };

    playNext();
    return true;
  } catch (e) {
    onError?.(e);
    return false;
  }
}

/** TTS speed setting persisted in localStorage. 0.7=slow, 0.95=normal, 1.3=fast */
export type TtsSpeed = 'slow' | 'normal' | 'fast';
const TTS_SPEED_RATES: Record<TtsSpeed, number> = { slow: 0.7, normal: 0.95, fast: 1.3 };

export function getTtsSpeed(): TtsSpeed {
  try {
    const v = localStorage.getItem('smartagricare_tts_speed');
    if (v === 'slow' || v === 'normal' || v === 'fast') return v;
  } catch { /* ignore */ }
  return 'normal';
}

export function setTtsSpeed(speed: TtsSpeed): void {
  try { localStorage.setItem('smartagricare_tts_speed', speed); } catch { /* ignore */ }
}

export interface SpeakOptions {
  text: string;
  language: string;           // "en" | "hi" | "te"
  rate?: number;
  onEnd?: () => void;
  onError?: (e: any) => void;
}

/**
 * Speak text using native bridge (Expo), Web Speech API, or Google TTS fallback.
 * Returns true if speech was initiated, false if no TTS available.
 */
export function speak(opts: SpeakOptions): boolean {
  const { text, language, onEnd, onError } = opts;
  // Use stored speed setting if caller didn't override
  const speedRate = TTS_SPEED_RATES[getTtsSpeed()];
  const rate = opts.rate ?? speedRate;

  // Native WebView bridge (expo-speech)
  if ((window as any).__NATIVE_TTS__ && (window as any).ReactNativeWebView) {
    _nativeTtsOnEnd = onEnd || null;
    (window as any).ReactNativeWebView.postMessage(JSON.stringify({
      type: "NATIVE_TTS_SPEAK", text, language,
    }));
    // Fallback timeout: if native side never sends DONE, clear after 30s
    setTimeout(() => {
      if (_nativeTtsOnEnd) {
        _nativeTtsOnEnd();
        _nativeTtsOnEnd = null;
      }
    }, 30000);
    return true;
  }

  const langCode = LANG_MAP[language] || "en-US";

  // Telugu, Kannada, Marathi: almost no browser has native voices for these.
  // Always route them through Google TTS for reliable audio.
  if (ALWAYS_USE_GTTS.has(language)) {
    window.speechSynthesis?.cancel();
    return speakWithGTTS(text, language, onEnd, onError);
  }

  const voice = findVoice(langCode);

  // If no native voice for this language, use Google Translate TTS fallback
  if (!voice) {
    window.speechSynthesis?.cancel();
    return speakWithGTTS(text, language, onEnd, onError);
  }

  if (!window.speechSynthesis) return false;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = rate;
  utter.lang = langCode;
  utter.voice = voice;

  if (onEnd) utter.onend = onEnd;
  utter.onerror = (e) => {
    console.error("TTS error:", e);
    onError?.(e);
  };

  window.speechSynthesis.speak(utter);
  return true;
}

export function stopSpeaking(): void {
  // Stop Google TTS fallback audio
  if (_gttsFallbackAudio) {
    _gttsFallbackAudio.pause();
    _gttsFallbackAudio = null;
  }
  // Clear native TTS callback
  _nativeTtsOnEnd = null;
  if ((window as any).__NATIVE_TTS__ && (window as any).ReactNativeWebView) {
    (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: "NATIVE_TTS_STOP" }));
    return;
  }
  window.speechSynthesis?.cancel();
}

/**
 * Strip markdown, emojis, and special characters so TTS reads naturally.
 * Preserves all Indic script characters (Devanagari, Telugu, Kannada, Malayalam).
 */
export function cleanForTts(text: string): string {
  // Remove emojis
  text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  // Remove markdown bold/italic
  text = text.replace(/\*{1,3}(.*?)\*{1,3}/gs, '$1');
  text = text.replace(/_{1,2}(.*?)_{1,2}/gs, '$1');
  // Remove code blocks
  text = text.replace(/`+.*?`+/gs, '');
  // Remove heading hashes
  text = text.replace(/^\s*#{1,6}\s*/gm, '');
  // Remove bullet markers
  text = text.replace(/^\s*[-\u2022*>|]+\s*/gm, '');
  text = text.replace(/^\s*\d+[.)]\s*/gm, '');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}
