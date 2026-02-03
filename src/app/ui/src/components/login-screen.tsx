"use client"

import * as React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Eye, EyeOff, Key, AlertTriangle, Loader2 } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"

export function LoginScreen() {
  const { login, error, isLoading } = useAuth()
  const [key, setKey] = useState("")
  const [showKey, setShowKey] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim() || isLoading) return
    await login(key.trim())
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6 space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-3">
              <Key className="w-6 h-6 text-primary" />
            </div>
          </div>
          <h1 className="text-xl font-semibold">Cipher</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to access Cipher
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Input
              type={showKey ? "text" : "password"}
              placeholder="Enter your access key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="pr-10"
              autoFocus
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!key.trim() || isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Verifying...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center">
          Enter your access key to continue
        </p>
      </Card>
    </div>
  )
}
