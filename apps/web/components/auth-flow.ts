export type ProtectedViewInput = {
  hydrated: boolean;
  token: string | null;
  hasWorkspace: boolean;
  pathname: string;
  search?: string;
  requireWorkspace?: boolean;
};

export type ProtectedViewDecision =
  | {
      kind: "loading";
      message: string;
    }
  | {
      kind: "redirect";
      location: string;
      message: string;
    }
  | {
      kind: "allow";
    };

export function sanitizeReturnTo(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  return trimmed;
}

function withReturnTo(pathname: string, returnTo?: string | null) {
  const safeReturnTo = sanitizeReturnTo(returnTo);

  if (!safeReturnTo) {
    return pathname;
  }

  return `${pathname}?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function getPostLoginPath(hasWorkspace: boolean, returnTo?: string | null) {
  const safeReturnTo = sanitizeReturnTo(returnTo);

  if (hasWorkspace) {
    return safeReturnTo ?? "/";
  }

  return withReturnTo("/workspace", safeReturnTo);
}

export function getWorkspaceSetupRedirect(hydrated: boolean, hasWorkspace: boolean, returnTo?: string | null) {
  if (!hydrated || !hasWorkspace) {
    return null;
  }

  return sanitizeReturnTo(returnTo) ?? "/";
}

export function evaluateProtectedView(input: ProtectedViewInput): ProtectedViewDecision {
  const requireWorkspace = input.requireWorkspace ?? true;
  const isOnboardingRoute = input.pathname === "/onboarding";
  const currentPath = sanitizeReturnTo(`${input.pathname}${input.search ?? ""}`) ?? input.pathname;

  if (!input.hydrated) {
    return {
      kind: "loading",
      message: "Loading session..."
    };
  }

  if (!input.token) {
    if (isOnboardingRoute) {
      return {
        kind: "allow"
      };
    }

    return {
      kind: "redirect",
      location: withReturnTo("/onboarding", currentPath),
      message: "Redirecting to onboarding..."
    };
  }

  if (requireWorkspace && !input.hasWorkspace) {
    if (input.pathname === "/workspace") {
      return {
        kind: "allow"
      };
    }

    return {
      kind: "redirect",
      location: withReturnTo("/workspace", currentPath),
      message: "Redirecting to workspace setup..."
    };
  }

  return {
    kind: "allow"
  };
}
