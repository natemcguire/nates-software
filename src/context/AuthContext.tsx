import React, { createContext, useContext, useState, useEffect } from 'react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  role: 'super_admin' | 'bot' | 'maker' | 'user';
  isSuperAdmin: boolean;
  isBot?: boolean;
}

export interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isAuthModalOpen: boolean;
  authModalTab: 'login' | 'register';
  actionDescription?: string | null;
  openAuthModal: (tab?: 'login' | 'register', actionDescription?: string | null) => void;
  closeAuthModal: () => void;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (data: { username: string; password: string; displayName: string; avatar?: string; bio?: string }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  requireAuth: (actionDescription: string, onAuthenticated: () => void) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');
  const [actionDescription, setActionDescription] = useState<string | null>(null);

  // Check existing session on load
  useEffect(() => {
    fetch('/api/auth?action=me')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.authenticated && data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  const openAuthModal = (tab: 'login' | 'register' = 'login', description: string | null = null) => {
    playClickSound();
    setAuthModalTab(tab);
    setActionDescription(description ?? null);
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    playClickSound();
    setIsAuthModalOpen(false);
    setActionDescription(null);
  };

  const login = async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
        setActionDescription(null);
        playSuccessChime();
        setIsAuthModalOpen(false);
        return { success: true };
      }
      return { success: false, error: data.error || 'Login failed' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  const register = async (formData: { username: string; password: string; displayName: string; avatar?: string; bio?: string }) => {
    try {
      const res = await fetch('/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
        setActionDescription(null);
        playSuccessChime();
        setIsAuthModalOpen(false);
        return { success: true };
      }
      return { success: false, error: data.error || 'Registration failed' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth?action=logout', { method: 'POST' });
    } catch {}
    setUser(null);
    setActionDescription(null);
    playClickSound();
  };

  const requireAuth = (actionDescription: string, onAuthenticated: () => void) => {
    if (user) {
      onAuthenticated();
    } else {
      openAuthModal('login', actionDescription);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isSuperAdmin: user?.role === 'super_admin',
        isAuthModalOpen,
        authModalTab,
        actionDescription,
        openAuthModal,
        closeAuthModal,
        login,
        register,
        logout,
        requireAuth
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const DEFAULT_AUTH_CONTEXT: AuthContextType = {
  user: null,
  isAuthenticated: false,
  isSuperAdmin: false,
  isAuthModalOpen: false,
  authModalTab: 'login',
  actionDescription: null,
  openAuthModal: () => {},
  closeAuthModal: () => {},
  login: async () => ({ success: false, error: 'AuthProvider not found' }),
  register: async () => ({ success: false, error: 'AuthProvider not found' }),
  logout: async () => {},
  requireAuth: (_actionDescription: string, _onAuthenticated: () => void) => {}
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  return context || DEFAULT_AUTH_CONTEXT;
};
