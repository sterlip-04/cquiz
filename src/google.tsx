import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Google Identity Services button. The browser receives a signed ID token from
// Google and sends it to the cquiz server, which verifies it before signing in.

type GoogleId = {
  initialize(options: {
    client_id: string;
    callback: (r: { credential: string }) => void;
    ux_mode?: "popup";
    auto_select?: boolean;
  }): void;
  renderButton(el: HTMLElement, options: Record<string, string | number>): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

export type AuthConfig = {
  googleClientId: string | null;
  googleAdmin: boolean;
};

let configPromise: Promise<AuthConfig> | null = null;
export function loadAuthConfig() {
  configPromise ??= api<AuthConfig>("/auth/config").catch(() => ({
    googleClientId: null,
    googleAdmin: false,
  }));
  return configPromise;
}
export function useAuthConfig() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  useEffect(() => {
    void loadAuthConfig().then(setConfig);
  }, []);
  return config;
}

let scriptPromise: Promise<void> | null = null;
function loadScript() {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(
        new Error("Google sign-in could not load. Check your connection."),
      );
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function GoogleButton({
  clientId,
  onCredential,
  onError,
  text = "signin_with",
}: {
  clientId: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
  text?: "signin_with" | "continue_with";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        const id = window.google?.accounts.id;
        if (cancelled || !id || !ref.current) return;
        id.initialize({
          client_id: clientId,
          callback: (r) => callback.current(r.credential),
          ux_mode: "popup",
          auto_select: false,
        });
        id.renderButton(ref.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text,
          width: Math.min(ref.current.offsetWidth || 320, 400),
        });
      })
      .catch((e: Error) => onError(e.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);
  return <div className="google-button" ref={ref} />;
}
