"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
    throw new Error(body.error ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export function useAuthedResource<T>(path: string, token: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setData(null);
      return;
    }

    setLoading(true);

    try {
      const result = await apiFetch<T>(path, token);
      setData(result);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [path, token]);

  useEffect(() => {
    void load();
  }, [load, ...deps]);

  return {
    data,
    error,
    loading,
    refresh: load
  };
}

export function currency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value ?? 0);
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
}
