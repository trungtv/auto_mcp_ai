import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, requestWithRetry, type McpSite } from "../api";

type AppSessionValue = {
  sites: McpSite[];
  cursorSdk: boolean;
  busy: string | null;
  error: string | null;
  message: string | null;
  setError: (v: string | null) => void;
  setMessage: (v: string | null) => void;
  refresh: (siteId?: string | null) => Promise<void>;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  runSafe: (label: string, fn: () => Promise<void>) => void;
  getSite: (id: string) => McpSite | undefined;
  upsertSite: (site: McpSite) => void;
  siteAuth: Record<string, { hasAuth: boolean; awaitingLoginConfirm: boolean }>;
  setSiteAuth: (
    siteId: string,
    patch: Partial<{ hasAuth: boolean; awaitingLoginConfirm: boolean }>,
  ) => void;
};

const AppSessionContext = createContext<AppSessionValue | null>(null);

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const [sites, setSites] = useState<McpSite[]>([]);
  const [cursorSdk, setCursorSdk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [siteAuth, setSiteAuthState] = useState<
    Record<string, { hasAuth: boolean; awaitingLoginConfirm: boolean }>
  >({});

  const setSiteAuth = useCallback(
    (
      siteId: string,
      patch: Partial<{ hasAuth: boolean; awaitingLoginConfirm: boolean }>,
    ) => {
      setSiteAuthState((prev) => {
        const cur = prev[siteId] ?? {
          hasAuth: false,
          awaitingLoginConfirm: false,
        };
        return { ...prev, [siteId]: { ...cur, ...patch } };
      });
    },
    [],
  );

  const upsertSite = useCallback((site: McpSite) => {
    setSites((prev) => {
      const i = prev.findIndex((s) => s.id === site.id);
      if (i < 0) return [site, ...prev];
      const next = [...prev];
      next[i] = site;
      return next;
    });
  }, []);

  const refresh = useCallback(async (siteId?: string | null) => {
    const [{ sites: list }, health] = await requestWithRetry(() =>
      Promise.all([api.listSites(), api.health()]),
    );
    setSites(list);
    setCursorSdk(health.cursorSdk);
    setError(null);
    if (siteId) {
      const [detail, loginStatus] = await Promise.all([
        api.getSite(siteId),
        api.loginStatus(siteId),
      ]);
      setSites((prev) =>
        prev.map((s) => (s.id === detail.site.id ? detail.site : s)),
      );
      setSiteAuth(siteId, {
        hasAuth: detail.hasAuth,
        awaitingLoginConfirm: loginStatus.awaitingConfirm,
      });
    }
  }, [setSiteAuth]);

  useEffect(() => {
    refresh().catch((e: unknown) =>
      setError(
        e instanceof Error
          ? `${e.message} (đợi control-plane :3847 sẵn sàng rồi refresh)`
          : String(e),
      ),
    );
  }, [refresh]);

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      setMessage(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const runSafe = useCallback(
    (label: string, fn: () => Promise<void>) => {
      void run(label, fn).catch(() => {
        /* error via setError */
      });
    },
    [run],
  );

  const getSite = useCallback(
    (id: string) => sites.find((s) => s.id === id),
    [sites],
  );

  const value = useMemo(
    () => ({
      sites,
      cursorSdk,
      busy,
      error,
      message,
      setError,
      setMessage,
      refresh,
      run,
      runSafe,
      getSite,
      upsertSite,
      siteAuth,
      setSiteAuth,
    }),
    [
      sites,
      cursorSdk,
      busy,
      error,
      message,
      refresh,
      run,
      runSafe,
      getSite,
      upsertSite,
      siteAuth,
      setSiteAuth,
    ],
  );

  return (
    <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>
  );
}

export function useAppSession(): AppSessionValue {
  const ctx = useContext(AppSessionContext);
  if (!ctx) throw new Error("useAppSession must be used within AppSessionProvider");
  return ctx;
}

export function useSiteSession(siteId: string | undefined) {
  const session = useAppSession();
  const site = siteId ? session.getSite(siteId) : undefined;
  const auth = siteId
    ? (session.siteAuth[siteId] ?? {
        hasAuth: false,
        awaitingLoginConfirm: false,
      })
    : { hasAuth: false, awaitingLoginConfirm: false };

  useEffect(() => {
    if (!siteId) return;
    void session.refresh(siteId).catch(() => {
      /* error via setError */
    });
  }, [siteId, session.refresh]);

  return {
    ...session,
    site,
    hasAuth: auth.hasAuth,
    awaitingLoginConfirm: auth.awaitingLoginConfirm,
  };
}
