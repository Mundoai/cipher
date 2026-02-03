"use client"

import * as React from "react"

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  role: string | null
  error: string | null
}

interface AuthContextValue extends AuthState {
  login: (key: string) => Promise<boolean>
  logout: () => void
  getAuthKey: () => string | null
}

const AUTH_STORAGE_KEY = "cipher-auth-key"

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    role: null,
    error: null,
  })

  const verifyKey = React.useCallback(async (key: string): Promise<{ success: boolean; role?: string }> => {
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      })
      const data = await response.json()
      if (data.success) {
        return { success: true, role: data.data?.role || "user" }
      }
      return { success: false }
    } catch {
      return { success: false }
    }
  }, [])

  // Check stored key on mount
  React.useEffect(() => {
    const storedKey = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!storedKey) {
      setState(s => ({ ...s, isLoading: false }))
      return
    }

    verifyKey(storedKey).then(result => {
      if (result.success) {
        setState({ isAuthenticated: true, isLoading: false, role: result.role || null, error: null })
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY)
        setState({ isAuthenticated: false, isLoading: false, role: null, error: null })
      }
    })
  }, [verifyKey])

  const login = React.useCallback(async (key: string): Promise<boolean> => {
    setState(s => ({ ...s, error: null, isLoading: true }))
    const result = await verifyKey(key)
    if (result.success) {
      localStorage.setItem(AUTH_STORAGE_KEY, key)
      setState({ isAuthenticated: true, isLoading: false, role: result.role || null, error: null })
      return true
    } else {
      setState(s => ({ ...s, isLoading: false, error: "Invalid key" }))
      return false
    }
  }, [verifyKey])

  const logout = React.useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setState({ isAuthenticated: false, isLoading: false, role: null, error: null })
  }, [])

  const getAuthKey = React.useCallback(() => {
    return localStorage.getItem(AUTH_STORAGE_KEY)
  }, [])

  const value = React.useMemo(() => ({
    ...state,
    login,
    logout,
    getAuthKey,
  }), [state, login, logout, getAuthKey])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
