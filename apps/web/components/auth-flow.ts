export type ProtectedViewInput = {
  hydrated: boolean;
  token: string | null;
  hasWorkspace: boolean;
  pathname: string;
  requireWorkspace?: boolean;
};

export type ProtectedViewDecision =
  | {
      kind: "loading";
      message: string;
    }
  | {
      kind: "redirect";
      location: "/onboarding" | "/workspace";
      message: string;
    }
  | {
      kind: "allow";
    };

export function getPostLoginPath(hasWorkspace: boolean) {
  return hasWorkspace ? "/" : "/workspace";
}

export function getWorkspaceSetupRedirect(hydrated: boolean, hasWorkspace: boolean) {
  if (!hydrated || !hasWorkspace) {
    return null;
  }

  return "/";
}

export function evaluateProtectedView(input: ProtectedViewInput): ProtectedViewDecision {
  const requireWorkspace = input.requireWorkspace ?? true;
  const isOnboardingRoute = input.pathname === "/onboarding";

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
      location: "/onboarding",
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
      location: "/workspace",
      message: "Redirecting to workspace setup..."
    };
  }

  return {
    kind: "allow"
  };
}
