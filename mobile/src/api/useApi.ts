/** Load a screen's data, keep the last copy for when he comes back, and refresh on pull. */
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "./client";

const cache = new Map<string, unknown>();

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(() => (path ? ((cache.get(path) as T | undefined) ?? null) : null));
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(path);
  latest.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    setRefreshing(true);
    try {
      const next = await api<T>(path);
      cache.set(path, next);
      if (latest.current === path) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (latest.current === path) setError(e instanceof ApiError ? e : new ApiError(0, "error", "Something went wrong."));
    } finally {
      setRefreshing(false);
    }
  }, [path]);

  // Fresh each time the screen comes into view (progress changes as he watches).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { data, error, refreshing, refresh: load, setData };
}
