"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AuthState = {
  token: string | null;
  user: { id: string; email: string } | null;
  workspace: {
    id: string;
    name: string;
    plan: string;
    billingCustomerId: string | null;
    connectorAutomationEnabled?: boolean;
  } | null;
  workspaces: Array<{
    id: string;
    name: string;
    plan: string;
    billingCustomerId: string | null;
    connectorAutomationEnabled?: boolean;
  }>;
  hydrated: boolean;
};

type AuthContextValue = AuthState & {
  login: (input: {
    token: string;
    user: { id: string; email: string };
    workspace: AuthState["workspace"];
    workspaces?: AuthState["workspaces"];
    redirectTo?: string | null;
  }) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    workspace: null,
    workspaces: [],
    hydrated: false
  });

  const refreshMe = useCallback(async () => {
    const token = window.localStorage.getItem("reselleros.token");

    if (!token) {
      setState((current) => ({ ...current, hydrated: true }));
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!response.ok) {
        window.localStorage.removeItem("reselleros.token");
        setState({
          token: null,
          user: null,
          workspace: null,
          workspaces: [],
          hydrated: true
        });
        return;
      }

      const payload = (await response.json()) as {
        user: { id: string; email: string };
        workspace: AuthState["workspace"];
        workspaces?: AuthState["workspaces"];
      };

      setState({
        token,
        user: payload.user,
        workspace: payload.workspace,
        workspaces: payload.workspaces ?? (payload.workspace ? [payload.workspace] : []),
        hydrated: true
      });
    } catch {
      window.localStorage.removeItem("reselleros.token");
      setState({
        token: null,
        user: null,
        workspace: null,
        workspaces: [],
        hydrated: true
      });
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login(input) {
          window.localStorage.setItem("reselleros.token", input.token);
          setState({
            token: input.token,
            user: input.user,
            workspace: input.workspace,
            workspaces: input.workspaces ?? (input.workspace ? [input.workspace] : []),
            hydrated: true
          });
          router.push(input.redirectTo ?? (input.workspace ? "/" : "/workspace"));
        },
        logout() {
          window.localStorage.removeItem("reselleros.token");
          setState({
            token: null,
            user: null,
            workspace: null,
            workspaces: [],
            hydrated: true
          });
          router.push("/onboarding");
        },
        refreshMe
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
