import { useAuth } from "@/contexts/AuthContext";
import { useApp } from "@/contexts/AppContext";
import { authAPI } from "@/services/api";
import { t } from "@/lib/i18n";
import { useNavigate } from "react-router-dom";
import MobileLayout from "@/components/MobileLayout";
import { User, Mail, Phone, MapPin, Globe, LogOut, Pencil, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { toast } from "sonner";

const languages = [
  { code: "en" as const, name: "English", native: "English", badge: "A",  badgeSub: "EN", color: "bg-blue-100 text-blue-700" },
  { code: "hi" as const, name: "Hindi",   native: "हिंदी",   badge: "अ",  badgeSub: "HI", color: "bg-orange-100 text-orange-700" },
  { code: "te" as const, name: "Telugu",  native: "తెలుగు",  badge: "అ",  badgeSub: "TE", color: "bg-green-100 text-green-700" },
  { code: "kn" as const, name: "Kannada", native: "ಕನ್ನಡ",  badge: "ಅ",  badgeSub: "KN", color: "bg-purple-100 text-purple-700" },
  { code: "mr" as const, name: "Marathi", native: "मराठी",  badge: "म",  badgeSub: "MR", color: "bg-red-100 text-red-700" },
];

const Profile = () => {
  const { user, logout, updateUser } = useAuth();
  const { language, setLanguage } = useApp();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({
    name: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    location: user?.location || "",
  });
  const [savedValues, setSavedValues] = useState({ ...editValues });
  const [showLangModal, setShowLangModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/auth", { replace: true });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await authAPI.updateProfile(parseInt(user?.id || '0'), {
        name: editValues.name,
        phone: editValues.phone,
        location: editValues.location,
      });
      setSavedValues({ ...editValues });
      updateUser({ name: editValues.name, phone: editValues.phone, location: editValues.location });
      setEditing(false);
      toast.success("Profile updated");
    } catch {
      toast.error("Failed to update profile");
    }
    setSaving(false);
  };

  const cancelEdit = () => {
    setEditValues({ ...savedValues });
    setEditing(false);
  };

  const currentLangLabel = languages.find(l => l.code === language)?.native || "English";

  const fields = [
    { icon: User, label: t('name', language), key: "name" as const },
    { icon: Mail, label: t('email', language), key: "email" as const },
    { icon: Phone, label: t('phone', language), key: "phone" as const },
    { icon: MapPin, label: t('location', language), key: "location" as const },
  ];

  return (
    <MobileLayout>
      <div className="px-5 pt-6">
        {/* Profile Header */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center mb-6">
          <div className="relative">
            <div className="h-24 w-24 rounded-full gradient-forest flex items-center justify-center mb-3">
              <User className="h-10 w-10 text-primary-foreground" />
            </div>
            <button
              onClick={() => setEditing(true)}
              className="absolute bottom-3 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-accent shadow-card"
            >
              <Pencil className="h-3.5 w-3.5 text-accent-foreground" />
            </button>
          </div>
          <h2 className="text-xl font-bold text-foreground">{savedValues.name}</h2>
          <p className="text-sm text-muted-foreground">{t('farmer', language)} • {savedValues.location}</p>
        </motion.div>

        {/* Account Details */}
        <div className="rounded-2xl bg-card shadow-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('account_details', language)}</h3>
            {!editing ? (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-accent font-medium">
                <Pencil className="h-3 w-3" /> {t('edit', language)}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={cancelEdit} className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                  <X className="h-3 w-3" /> {t('cancel', language)}
                </button>
                <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1 text-xs text-accent font-medium disabled:opacity-50">
                  <Check className="h-3 w-3" /> {saving ? t('saving', language) : t('save', language)}
                </button>
              </div>
            )}
          </div>

          {fields.map(item => (
            <div key={item.label} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
              <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                {editing && item.key !== "email" ? (
                  <input
                    value={editValues[item.key]}
                    onChange={e => setEditValues(prev => ({ ...prev, [item.key]: e.target.value }))}
                    className="w-full text-sm text-foreground bg-transparent border-b border-accent focus:outline-none py-0.5"
                  />
                ) : (
                  <p className="text-sm text-foreground">{savedValues[item.key]}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Language — click to open modal, tap language to apply instantly */}
        <div className="rounded-2xl bg-card shadow-card overflow-hidden mb-4">
          <button
            onClick={() => setShowLangModal(true)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-sm text-foreground">{t('language', language)}</span>
            <span className="text-xs text-muted-foreground mr-1">{currentLangLabel}</span>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        <button onClick={handleLogout} className="w-full rounded-xl border border-destructive py-3.5 text-sm font-semibold text-destructive transition-transform active:scale-[0.98]">
          <LogOut className="inline h-4 w-4 mr-2" />{t('logout', language)}
        </button>
      </div>

      {/* Language Modal — tap to apply, no OK button */}
      <AnimatePresence>
        {showLangModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm"
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
                    className={`flex items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left transition-all ${
                      language === lang.code ? "border-accent bg-accent/5" : "border-border bg-background"
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

export default Profile;
