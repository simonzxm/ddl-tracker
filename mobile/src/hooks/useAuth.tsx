import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';
import { User, AuthState } from '../types';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, code: string, nickname: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    try {
      await api.init();
      const user = await api.getMe();
      setState({ user, isLoading: false, isAuthenticated: true });
    } catch {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  };

  const login = async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    setState({ user, isLoading: false, isAuthenticated: true });
  };

  const register = async (email: string, code: string, nickname: string, password: string) => {
    const { user } = await api.register(email, code, nickname, password);
    setState({ user, isLoading: false, isAuthenticated: true });
  };

  const logout = async () => {
    await api.logout();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  };

  const refresh = async () => {
    try {
      const user = await api.getMe();
      setState({ user, isLoading: false, isAuthenticated: true });
    } catch {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
