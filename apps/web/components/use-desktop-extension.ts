"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "./auth-provider";
import { connectMollieExtensionSession, detectMollieExtension } from "../lib/extension-bridge";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function useDesktopExtension() {
  const auth = useAuth();
  const [installed, setInstalled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!auth.token || !auth.user || !auth.workspace) {
      setInstalled(false);
      setConnected(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const present = await detectMollieExtension();
    setInstalled(present);

    if (!present) {
      setConnected(false);
      setLoading(false);
      return;
    }

    const response = await connectMollieExtensionSession({
      token: auth.token,
      userId: auth.user.id,
      email: auth.user.email,
      workspaceId: auth.workspace.id,
      apiBaseUrl: API_BASE_URL
    });

    setConnected(Boolean(response.ok));
    setLoading(false);
  }, [auth.token, auth.user, auth.workspace]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    installed,
    connected,
    loading,
    refresh
  };
}
