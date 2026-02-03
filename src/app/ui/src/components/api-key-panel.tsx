"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog"
import { Copy, Plus, Trash2, Key, Eye, EyeOff, AlertTriangle } from "lucide-react"
import { apiClient } from "@/lib/api-client"

interface ApiKeyInfo {
  id: string
  name: string
  prefix: string
  permissions: string[]
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
  revoked: boolean
}

interface ApiKeyPanelProps {
  isOpen: boolean
}

export function ApiKeyPanel({ isOpen }: ApiKeyPanelProps) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adminKey, setAdminKey] = useState("")
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [showAdminKey, setShowAdminKey] = useState(false)

  // Create key dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchKeys = useCallback(async () => {
    if (!adminKey) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `${apiClient['baseUrl']}/api/admin/keys`,
        {
          headers: {
            'Authorization': `Bearer ${adminKey}`,
            'Content-Type': 'application/json',
          },
        }
      )

      const data = await response.json()

      if (data.success) {
        setKeys(data.data || [])
        setIsAuthenticated(true)
      } else {
        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false)
          setError("Invalid admin key")
        } else {
          setError(data.error?.message || "Failed to fetch keys")
        }
      }
    } catch {
      setError("Network error - is the API server running?")
    } finally {
      setLoading(false)
    }
  }, [adminKey])

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      fetchKeys()
    }
  }, [isOpen, isAuthenticated, fetchKeys])

  const handleLogin = async () => {
    if (!adminKey.trim()) return
    await fetchKeys()
  }

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return

    try {
      const response = await fetch(
        `${apiClient['baseUrl']}/api/admin/keys`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: newKeyName.trim() }),
        }
      )

      const data = await response.json()

      if (data.success) {
        setCreatedKey(data.data.key)
        setNewKeyName("")
        fetchKeys()
      } else {
        setError(data.error?.message || "Failed to create key")
      }
    } catch {
      setError("Failed to create key")
    }
  }

  const handleRevokeKey = async (keyId: string) => {
    try {
      const response = await fetch(
        `${apiClient['baseUrl']}/api/admin/keys/${keyId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${adminKey}`,
            'Content-Type': 'application/json',
          },
        }
      )

      const data = await response.json()

      if (data.success) {
        fetchKeys()
      } else {
        setError(data.error?.message || "Failed to revoke key")
      }
    } catch {
      setError("Failed to revoke key")
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return "Never"
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (!isOpen) return null

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border/50">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Key className="w-4 h-4" />
          API Keys
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Manage API keys for project integrations
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!isAuthenticated ? (
          <div className="space-y-3">
            <Label className="text-xs">Admin Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showAdminKey ? "text" : "password"}
                  placeholder="Enter admin key..."
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="pr-8 text-xs"
                />
                <button
                  onClick={() => setShowAdminKey(!showAdminKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showAdminKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
              <Button size="sm" onClick={handleLogin} disabled={loading}>
                {loading ? "..." : "Login"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Use the CIPHER_ADMIN_KEY from server logs
            </p>
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>
        ) : (
          <>
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1 mb-2">
                <AlertTriangle className="w-3 h-3" />
                {error}
              </p>
            )}

            <Button
              size="sm"
              onClick={() => setShowCreateDialog(true)}
              className="w-full"
            >
              <Plus className="w-3 h-3 mr-1" />
              Create API Key
            </Button>

            {keys.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No API keys yet. Create one to get started.
              </p>
            ) : (
              <div className="space-y-2">
                {keys.map((key) => (
                  <Card key={key.id} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{key.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeKey(key.id)}
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        title="Revoke key"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {key.prefix}
                      </code>
                      {key.revoked && (
                        <Badge variant="destructive" className="text-[10px]">
                          Revoked
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground space-y-0.5">
                      <div>Created: {formatDate(key.createdAt)}</div>
                      <div>Last used: {formatDate(key.lastUsedAt)}</div>
                      {key.expiresAt && (
                        <div>Expires: {formatDate(key.expiresAt)}</div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Key Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => {
        setShowCreateDialog(open)
        if (!open) {
          setCreatedKey(null)
          setNewKeyName("")
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {createdKey ? "API Key Created" : "Create API Key"}
            </DialogTitle>
            <DialogDescription>
              {createdKey
                ? "Copy this key now. It will not be shown again."
                : "Give your API key a descriptive name."}
            </DialogDescription>
          </DialogHeader>

          {createdKey ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted p-2 rounded font-mono break-all">
                  {createdKey}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(createdKey)}
                >
                  <Copy className="w-3 h-3 mr-1" />
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-amber-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Store this key securely. It cannot be retrieved later.
              </p>
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-medium">Connect your IDE via MCP:</p>
                <div className="relative">
                  <code className="block text-[10px] bg-muted p-2 rounded font-mono break-all whitespace-pre">
{`{
  "mcpServers": {
    "cipher": {
      "type": "sse",
      "url": "${typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp/sse"
    }
  }
}`}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 right-1 h-5 w-5 p-0"
                    onClick={() => copyToClipboard(JSON.stringify({
                      mcpServers: {
                        cipher: {
                          type: "sse",
                          url: `${typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp/sse`
                        }
                      }
                    }, null, 2))}
                    title="Copy MCP config"
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Add to .mcp.json in your project root (Claude Code, Cursor, VS Code)
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="keyName" className="text-xs">Name</Label>
                <Input
                  id="keyName"
                  placeholder="e.g., Production API Key"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateKey()}
                  className="mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {createdKey ? (
              <Button onClick={() => {
                setShowCreateDialog(false)
                setCreatedKey(null)
              }}>
                Done
              </Button>
            ) : (
              <Button onClick={handleCreateKey} disabled={!newKeyName.trim()}>
                Create
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
