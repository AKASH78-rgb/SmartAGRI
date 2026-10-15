import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { authAPI } from "@/services/api";

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  location?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isValidating: boolean;   // true while checking stored token on mount
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  logout: () => void;
  updateUser: (fields: Partial<Omit<User, 'id' | 'email'>>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem("smartagricare_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // isValidating: true until we confirm the stored token is still valid
  const [isValidating, setIsValidating] = useState<boolean>(() => {
    try {
      return !!(localStorage.getItem("smartagricare_token") && localStorage.getItem("smartagricare_user"));
    } catch {
      return false;
    }
  });

  // Validate stored token against backend on mount
  useEffect(() => {
    const token = localStorage.getItem("smartagricare_token");
    if (!token || !user) {
      setIsValidating(false);
      return;
    }
    authAPI.validate(token).then(data => {
      if (!data.success) {
        setUser(null);
        try {
          localStorage.removeItem("smartagricare_user");
          localStorage.removeItem("smartagricare_token");
        } catch { /* ignore */ }
      }
      setIsValidating(false);
    }).catch(() => {
      // Network error on startup — keep user logged in, don't clear
      setIsValidating(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authAPI.login(email, password);
    if (!data.success) throw new Error(data.error || "Login failed");
    const u = { ...data.user, id: String(data.user.id) };
    setUser(u);
    try { localStorage.setItem("smartagricare_user", JSON.stringify(u)); } catch { /* ignore */ }
    if (data.token) try { localStorage.setItem("smartagricare_token", data.token); } catch { /* ignore */ }
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string, phone = '') => {
    const data = await authAPI.register(name, email, password, phone);
    if (!data.success) throw new Error(data.error || "Registration failed");
    if (!data.user?.id) throw new Error("Registration failed: no user ID returned");
    const u: User = {
      ...data.user,
      id: String(data.user.id),
      name: data.user.name || name,
      email: data.user.email || email,
      phone: data.user.phone || phone,
    };
    setUser(u);
    try { localStorage.setItem("smartagricare_user", JSON.stringify(u)); } catch { /* ignore */ }
    if (data.token) {
      try { localStorage.setItem("smartagricare_token", data.token); } catch { /* ignore */ }
    }
  }, []);

  const logout = useCallback(() => {
    const token = localStorage.getItem("smartagricare_token");
    setUser(null);
    try {
      localStorage.removeItem("smartagricare_user");
      localStorage.removeItem("smartagricare_token");
    } catch { /* ignore */ }
    if (token) {
      fetch(`${import.meta.env.VITE_API_URL || ''}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }
  }, []);

  const updateUser = useCallback((fields: Partial<Omit<User, 'id' | 'email'>>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...fields };
      try { localStorage.setItem("smartagricare_user", JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isValidating, login, signup, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};
