'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import Button from '@/components/ui/Button';

interface PageActionApi {
  /** Whether the page's primary-action owner has registered its handler. */
  ready: boolean;
  /** Runs the registered handler, if any. */
  run: () => void;
  /** Called by the owner (manager) whenever its handler changes or unmounts. */
  register: (handler: (() => void) | null) => void;
}

const PageActionContext = createContext<PageActionApi>({
  ready: false,
  run: () => {},
  register: () => {},
});

/**
 * Connects a `PageHeader` `actions` slot (rendered by the server page) to the
 * client manager that owns the screen's primary flow — the "New subject" /
 * "New academic year" modal. A server page cannot pass an event handler to a
 * client component, so the manager registers its handler here instead of
 * keeping the primary button inside its own toolbar.
 *
 *   <PageActionProvider>                 // page (server component)
 *     <PageHeader actions={<PageActionButton label="New Subject" />} />
 *     <SubjectsManager … />              // calls register(() => openForm(…))
 *   </PageActionProvider>
 */
export function PageActionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const handlerRef = useRef<(() => void) | null>(null);

  const register = useCallback((handler: (() => void) | null) => {
    handlerRef.current = handler;
    setReady(handler !== null);
  }, []);

  const run = useCallback(() => {
    handlerRef.current?.();
  }, []);

  const value = useMemo<PageActionApi>(() => ({ ready, run, register }), [ready, run, register]);

  return <PageActionContext.Provider value={value}>{children}</PageActionContext.Provider>;
}

/**
 * Registers the owning manager's primary-action handler for this page.
 * Runs on every render because handlers close over fresh state; `register`
 * stores it in a ref, so the repeated call never causes a render loop.
 */
export function useRegisterPageAction(handler: () => void): void {
  const { register } = useContext(PageActionContext);

  useEffect(() => {
    register(handler);
    return () => register(null);
  });
}

/** Primary button for the `PageHeader` `actions` slot; disabled until registered. */
export function PageActionButton({ label }: { label: string }): JSX.Element {
  const { ready, run } = useContext(PageActionContext);
  return (
    <Button size="sm" disabled={!ready} onClick={run}>
      {label}
    </Button>
  );
}
