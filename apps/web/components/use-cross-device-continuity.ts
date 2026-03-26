"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RefreshReason = "focus" | "poll";

type UseCrossDeviceContinuityInput = {
  enabled: boolean;
  fingerprint: string | null;
  refresh: () => Promise<void>;
  intervalMs?: number;
};

export function useCrossDeviceContinuity({
  enabled,
  fingerprint,
  refresh,
  intervalMs = 20_000
}: UseCrossDeviceContinuityInput) {
  const previousFingerprintRef = useRef<string | null>(null);
  const pendingReasonRef = useRef<RefreshReason | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clearNotice = useCallback(() => {
    if (noticeTimeoutRef.current) {
      clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = null;
    }
  }, []);

  const refreshWithReason = useCallback(
    async (reason: RefreshReason) => {
      if (!enabled || typeof document === "undefined" || document.visibilityState === "hidden") {
        return;
      }

      if (refreshInFlightRef.current) {
        await refreshInFlightRef.current;
        return;
      }

      pendingReasonRef.current = reason;
      const currentRefresh = (async () => {
        try {
          await refresh();
          setLastSyncedAt(new Date());
        } finally {
          refreshInFlightRef.current = null;
        }
      })();

      refreshInFlightRef.current = currentRefresh;
      await currentRefresh;
    },
    [enabled, refresh]
  );

  useEffect(() => {
    if (!enabled || !fingerprint) {
      return;
    }

    if (!previousFingerprintRef.current) {
      previousFingerprintRef.current = fingerprint;
      setLastSyncedAt(new Date());
      pendingReasonRef.current = null;
      return;
    }

    if (previousFingerprintRef.current !== fingerprint && pendingReasonRef.current) {
      clearNotice();
      setNotice("Changes detected from another device");
      noticeTimeoutRef.current = setTimeout(() => {
        setNotice(null);
        noticeTimeoutRef.current = null;
      }, 4_000);
    }

    previousFingerprintRef.current = fingerprint;
    pendingReasonRef.current = null;
  }, [clearNotice, enabled, fingerprint]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleFocus = () => {
      void refreshWithReason("focus");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshWithReason("focus");
      }
    };

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshWithReason("poll");
      }
    }, intervalMs);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearNotice();
    };
  }, [clearNotice, enabled, intervalMs, refreshWithReason]);

  return {
    continuityNotice: notice,
    lastSyncedLabel: lastSyncedAt
      ? lastSyncedAt.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit"
        })
      : null
  };
}
