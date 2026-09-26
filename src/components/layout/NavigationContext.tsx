'use client';

import { createContext, useContext, useState, useCallback, type JSX, type ReactNode } from 'react';
import type { NavigationItem } from '@/config/navigation';

interface NavigationContextValue {
  contextualNav: NavigationItem[];
  contextualNavPath: string;
  setContextualNav: (items: NavigationItem[], path?: string) => void;
  clearContextualNav: () => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }): JSX.Element {
  const [contextualNav, setContextualNavState] = useState<NavigationItem[]>([]);
  const [contextualNavPath, setContextualNavPath] = useState<string>('');

  const setContextualNav = useCallback((items: NavigationItem[], path?: string) => {
    setContextualNavState(items);
    if (path !== undefined) setContextualNavPath(path);
  }, []);

  const clearContextualNav = useCallback(() => {
    setContextualNavState([]);
    setContextualNavPath('');
  }, []);

  return (
    <NavigationContext.Provider value={{ contextualNav, contextualNavPath, setContextualNav, clearContextualNav }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigationContext(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigationContext must be used within a NavigationProvider');
  }
  return context;
}