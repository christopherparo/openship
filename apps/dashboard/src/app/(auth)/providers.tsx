"use client";

import React, { createContext, useContext } from "react";
import { CLOUD_DASHBOARD_URL } from "@repo/core";

interface AuthContextValue {
  authMode: "cloud" | "local" | "none";
  cloudAuthUrl: string;
  selfHosted: boolean;
  oauthProviders: {
    github?: boolean;
    google?: boolean;
  };
  googleClientId?: string;
}

const AuthContext = createContext<AuthContextValue>({
  authMode: "local",
  cloudAuthUrl: CLOUD_DASHBOARD_URL,
  selfHosted: true,
  oauthProviders: {},
});

export function useAuthContext() {
  return useContext(AuthContext);
}

interface AuthProvidersProps {
  children: React.ReactNode;
  authMode: "cloud" | "local" | "none";
  cloudAuthUrl: string;
  selfHosted: boolean;
  oauthProviders?: {
    github?: boolean;
    google?: boolean;
  };
  googleClientId?: string;
}

export function AuthProviders({ children, authMode, cloudAuthUrl, selfHosted, oauthProviders = {}, googleClientId }: AuthProvidersProps) {
  return (
    <AuthContext.Provider value={{ authMode, cloudAuthUrl, selfHosted, oauthProviders, googleClientId }}>
      {children}
    </AuthContext.Provider>
  );
}
