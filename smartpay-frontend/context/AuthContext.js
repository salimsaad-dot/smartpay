"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on first load by asking the backend who the cookie
  // belongs to — the frontend has no way to inspect an httpOnly cookie
  // itself.
  useEffect(() => {
    apiRequest("/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  async function registerSchool(payload) {
    const res = await apiRequest("/auth/register-school", { method: "POST", body: payload });
    setUser({
      userId: res.data.userId,
      name: payload.adminName,
      email: payload.email,
      role: res.data.role,
      school: { id: res.data.schoolId, name: res.data.schoolName, code: res.data.code },
    });
    return res.data;
  }

  async function login(email, password) {
    const res = await apiRequest("/auth/login", { method: "POST", body: { email, password } });
    setUser(res.data);
    return res.data;
  }

  async function logout() {
    setUser(null);
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {
      // Already logged out client-side regardless.
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, registerSchool, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
