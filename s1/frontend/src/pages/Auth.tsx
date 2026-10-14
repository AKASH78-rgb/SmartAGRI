import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useApp } from "@/contexts/AppContext";
import { authAPI } from "@/services/api";
import { t } from "@/lib/i18n";
import { Mail, Lock, User, Eye, EyeOff, ArrowLeft, KeyRound, Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import farmHero from "@/assets/farm-hero.jpg";
import { toast } from "sonner";

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Minimum 6 characters"),
});

const signupSchema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Invalid email"),
  phone: z.string().optional().refine(v => !v || /^\d{10}$/.test(v.replace(/\D/g, '').slice(-10)), { message: "Enter a valid 10-digit phone number" }),
  password: z.string().min(6, "Minimum 6 characters"),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });

type LoginForm = z.infer<typeof loginSchema>;
type SignupForm = z.infer<typeof signupSchema>;

const Auth = () => {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [showPw, setShowPw] = useState(false);
  const [forgotStep, setForgotStep] = useState<null | "email" | "otp">(null);
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPw, setResetNewPw] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const { login, signup, isAuthenticated, isValidating } = useAuth();
  const { language } = useApp();
  const navigate = useNavigate();

  // Redirect already-authenticated users away from /auth
  useEffect(() => {
    if (!isValidating && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isValidating, navigate]);

  const loginForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const signupForm = useForm<SignupForm>({ resolver: zodResolver(signupSchema) });

  const onLogin = async (data: LoginForm) => {
    setAuthError("");
    setAuthLoading(true);
    try {
      await login(data.email, data.password);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const msg = err?.message || "Login failed";
      if (msg.toLowerCase().includes("fetch")) {
        setAuthError("Network Error: Cannot reach server. Check Wi-Fi or Firewall.");
      } else {
        setAuthError(msg);
      }
    }
    setAuthLoading(false);
  };
  const onSignup = async (data: SignupForm) => {
    setAuthError("");
    setAuthLoading(true);
    try {
      await signup(data.name, data.email, data.password, data.phone || "");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      setAuthError(err?.message || "Signup failed");
    }
    setAuthLoading(false);
  };

  const handleForgotSendOtp = async () => {
    if (!resetEmail || !resetEmail.includes("@")) {
      toast.error("Please enter a valid email");
      return;
    }
    setResetLoading(true);
    try {
      const res = await authAPI.forgotPassword(resetEmail);
      if (res.success) {
        toast.success(res.message);
        setForgotStep("otp");
      } else {
        toast.error(res.error || "Failed to send reset code");
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to send reset code";
      if (msg.toLowerCase().includes("fetch")) {
        toast.error("Network Error: Server unreachable");
      } else {
        toast.error(msg);
      }
    }
    setResetLoading(false);
  };

  const handleResetPassword = async () => {
    if (!resetOtp || resetOtp.length !== 6) {
      toast.error("Please enter the 6-digit code");
      return;
    }
    if (!resetNewPw || resetNewPw.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setResetLoading(true);
    try {
      const res = await authAPI.resetPassword(resetEmail, resetOtp, resetNewPw);
      if (res.success) {
        toast.success(t('password_reset_success', language));
        setForgotStep(null);
        setResetEmail("");
        setResetOtp("");
        setResetNewPw("");
        setTab("login");
      } else {
        toast.error(res.error || "Reset failed");
      }
    } catch (err: any) {
      const msg = err?.message || "Reset failed";
      if (msg.toLowerCase().includes("fetch")) {
        toast.error("Network Error: Server unreachable");
      } else {
        toast.error(msg);
      }
    }
    setResetLoading(false);
  };

  const inputCls = "w-full rounded-xl border border-border bg-card py-3.5 pl-11 pr-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent";
  const iconCls = "absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground";

  return (
    <div className="relative flex min-h-[100dvh] items-end justify-center pb-8 pt-12">
      <img src={farmHero} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/95 to-background/40" />

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-sm px-6">
        <AnimatePresence mode="wait">
          {/* Forgot Password flow */}
          {forgotStep ? (
            <motion.div key="forgot" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
              <button onClick={() => { setForgotStep(null); setResetOtp(""); setResetNewPw(""); }} className="flex items-center gap-1 text-sm text-accent font-medium mb-4">
                <ArrowLeft className="h-4 w-4" /> {t('back_to_login', language)}
              </button>
              <h1 className="mb-1 text-2xl font-bold text-foreground">{t('reset_password', language)}</h1>

              {forgotStep === "email" ? (
                <>
                  <p className="mb-6 text-sm text-muted-foreground">{t('enter_email', language)}</p>
                  <div className="flex flex-col gap-4">
                    <div className="relative">
                      <Mail className={iconCls} />
                      <input value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="Email" aria-label="Email address for password reset" className={inputCls} />
                    </div>
                    <button onClick={handleForgotSendOtp} disabled={resetLoading} className="w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground disabled:opacity-50 active:scale-[0.98] transition-transform">
                      {resetLoading ? <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" /> : t('send_otp', language)}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-6 text-sm text-muted-foreground">{t('enter_otp', language)}</p>
                  <div className="flex flex-col gap-4">
                    <div className="relative">
                      <KeyRound className={iconCls} />
                      <input value={resetOtp} onChange={e => setResetOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" inputMode="numeric" maxLength={6} aria-label="6-digit reset code" className={inputCls} />
                    </div>
                    <div className="relative">
                      <Lock className={iconCls} />
                      <input type="password" value={resetNewPw} onChange={e => setResetNewPw(e.target.value)} placeholder={t('new_password', language)} aria-label="New password" className={inputCls} />
                    </div>
                    <button onClick={handleResetPassword} disabled={resetLoading} className="w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground disabled:opacity-50 active:scale-[0.98] transition-transform">
                      {resetLoading ? <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" /> : t('reset_password', language)}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          ) : (
            <motion.div key="auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }}>
              <h1 className="mb-1 text-2xl font-bold text-foreground">{t('welcome_smartagricare', language)}</h1>
              <p className="mb-6 text-sm text-muted-foreground">{t('join_farmers', language)}</p>

              <div className="mb-6 flex rounded-xl bg-muted p-1">
                {(["login", "signup"] as const).map(tb => (
                  <button key={tb} onClick={() => { setTab(tb); setAuthError(""); }}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-all ${tab === tb ? "bg-card text-foreground shadow-card" : "text-muted-foreground"}`}>
                    {tb === "login" ? t('login', language) : t('sign_up', language)}
                  </button>
                ))}
              </div>

              {authError && <p className="text-xs text-destructive mb-3 text-center">{authError}</p>}

              {tab === "login" ? (
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="flex flex-col gap-4">
                  <div className="relative">
                    <Mail className={iconCls} />
                    <input {...loginForm.register("email")} placeholder="Email" aria-label="Email address" className={inputCls} />
                  </div>
                  {loginForm.formState.errors.email && <p className="text-xs text-destructive -mt-2">{loginForm.formState.errors.email.message}</p>}
                  <div className="relative">
                    <Lock className={iconCls} />
                    <input {...loginForm.register("password")} type={showPw ? "text" : "password"} placeholder="Password" aria-label="Password" className={inputCls} />
                    <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {loginForm.formState.errors.password && <p className="text-xs text-destructive -mt-2">{loginForm.formState.errors.password.message}</p>}

                  <button type="button" onClick={() => setForgotStep("email")} className="text-xs text-accent font-medium text-right -mt-2">
                    {t('forgot_password', language)}
                  </button>

                  <button type="submit" disabled={authLoading} className="w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-60">
                    {authLoading ? <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" /> : t('login', language)}
                  </button>
                  <p className="text-center text-sm text-muted-foreground">{t('dont_have_account', language)} <button type="button" onClick={() => setTab("signup")} className="text-accent font-medium">{t('sign_up', language)}</button></p>
                </form>
              ) : (
                <form onSubmit={signupForm.handleSubmit(onSignup)} className="flex flex-col gap-4">
                  <div className="relative"><User className={iconCls} /><input {...signupForm.register("name")} placeholder="Full Name" aria-label="Full name" className={inputCls} /></div>
                  {signupForm.formState.errors.name && <p className="text-xs text-destructive -mt-2">{signupForm.formState.errors.name.message}</p>}
                  <div className="relative"><Mail className={iconCls} /><input {...signupForm.register("email")} placeholder="Email" aria-label="Email address" className={inputCls} /></div>
                  {signupForm.formState.errors.email && <p className="text-xs text-destructive -mt-2">{signupForm.formState.errors.email.message}</p>}
                  <div className="relative"><Phone className={iconCls} /><input {...signupForm.register("phone")} inputMode="tel" placeholder="Phone (optional)" aria-label="Phone number" className={inputCls} /></div>
                  {signupForm.formState.errors.phone && <p className="text-xs text-destructive -mt-2">{signupForm.formState.errors.phone.message}</p>}
                  <div className="relative">
                    <Lock className={iconCls} />
                    <input {...signupForm.register("password")} type={showPw ? "text" : "password"} placeholder="Password" aria-label="Password" className={inputCls} />
                    <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {signupForm.formState.errors.password && <p className="text-xs text-destructive -mt-2">{signupForm.formState.errors.password.message}</p>}
                  <div className="relative"><Lock className={iconCls} /><input {...signupForm.register("confirmPassword")} type="password" placeholder="Confirm Password" aria-label="Confirm password" className={inputCls} /></div>
                  {signupForm.formState.errors.confirmPassword && <p className="text-xs text-destructive -mt-2">{signupForm.formState.errors.confirmPassword.message}</p>}
                  <button type="submit" disabled={authLoading} className="w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-60">
                    {authLoading ? <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" /> : t('create_account', language)}
                  </button>
                  <p className="text-center text-sm text-muted-foreground">{t('already_registered', language)} <button type="button" onClick={() => setTab("login")} className="text-accent font-medium">{t('login', language)}</button></p>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default Auth;
