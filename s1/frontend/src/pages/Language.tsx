import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/contexts/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { Check } from "lucide-react";
import { motion } from "framer-motion";

const languages = [
  {
    code: "en" as const,
    name: "English",
    native: "English",
    badge: "A",           // Latin A
    badgeSub: "EN",
    color: "bg-blue-100 text-blue-700",
  },
  {
    code: "hi" as const,
    name: "Hindi",
    native: "हिंदी",
    badge: "अ",           // Devanagari 'a'
    badgeSub: "HI",
    color: "bg-orange-100 text-orange-700",
  },
  {
    code: "te" as const,
    name: "Telugu",
    native: "తెలుగు",
    badge: "అ",           // Telugu 'a'
    badgeSub: "TE",
    color: "bg-green-100 text-green-700",
  },
  {
    code: "kn" as const,
    name: "Kannada",
    native: "ಕನ್ನಡ",
    badge: "ಅ",           // Kannada 'a'
    badgeSub: "KN",
    color: "bg-purple-100 text-purple-700",
  },
  {
    code: "mr" as const,
    name: "Marathi",
    native: "मराठी",
    badge: "म",           // Devanagari 'ma' (first letter of मराठी)
    badgeSub: "MR",
    color: "bg-red-100 text-red-700",
  },
];

const Language = () => {
  const { language, setLanguage } = useApp();
  const [selected, setSelected] = useState(language);
  const navigate = useNavigate();
  const { isAuthenticated, isValidating } = useAuth();

  // If already logged in, skip to dashboard
  useEffect(() => {
    if (!isValidating && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, isValidating, navigate]);

  const handleContinue = () => {
    setLanguage(selected);
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      navigate("/auth");
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 gradient-mint">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-2xl font-bold text-foreground">Choose Your Language</h1>
        <p className="mb-8 text-center text-sm text-muted-foreground">Select your preferred language</p>

        <div className="flex flex-col gap-3">
          {languages.map((lang, i) => (
            <motion.button
              key={lang.code}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => setSelected(lang.code)}
              className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-all shadow-card bg-card ${
                selected === lang.code ? "border-accent bg-accent/5" : "border-transparent"
              }`}
            >
              {/* Language badge — native script letter + code */}
              <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl ${lang.color}`}>
                <span className="text-lg font-bold leading-none">{lang.badge}</span>
                <span className="text-[9px] font-semibold leading-none mt-0.5 tracking-wide opacity-70">{lang.badgeSub}</span>
              </div>

              <div className="flex-1">
                <p className="font-semibold text-foreground">{lang.native}</p>
                <p className="text-sm text-muted-foreground">{lang.name}</p>
              </div>

              {selected === lang.code && (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent">
                  <Check className="h-4 w-4 text-accent-foreground" />
                </div>
              )}
            </motion.button>
          ))}
        </div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={handleContinue}
          className="mt-8 w-full rounded-xl bg-primary py-4 text-center font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          Continue
        </motion.button>
      </motion.div>
    </div>
  );
};

export default Language;
