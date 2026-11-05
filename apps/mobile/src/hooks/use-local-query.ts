import { QueryRevisionContext } from '../providers/QueryRevision';
import { useFocusEffect } from 'expo-router';
import { useCallback, useContext, useRef, useState, type Context } from 'react';

export interface LocalQueryOptions {
  queryKey?: string;
  context?: Context<number>;
  extraRevision?: number;
}

export function useFocusedValue<T>(
  load: () => Promise<T>,
  initial: T,
  options?: LocalQueryOptions,
) {
  const revisionContext = options?.context ?? QueryRevisionContext;
  const dataRevision = useContext(revisionContext);
  const extraRevision = options?.extraRevision ?? 0;
  const effectiveRevision = dataRevision + extraRevision;
  const queryKey = options?.queryKey;

  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  const generation = useRef(0);
  const lastKeyRef = useRef<string | undefined>(queryKey);
  const hasLoadedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      const keyChanged = lastKeyRef.current !== queryKey;
      lastKeyRef.current = queryKey;

      if (keyChanged) {
        setValue(initial);
        hasLoadedRef.current = false;
        setLoading(true);
      } else if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setError(false);

      void load()
        .then(
          (result) => {
            if (generation.current !== current) return;
            setValue(result);
            hasLoadedRef.current = true;
          },
          () => {
            if (generation.current === current) setError(true);
          },
        )
        .finally(() => {
          if (generation.current === current) setLoading(false);
        });

      return () => {
        generation.current++;
      };
    }, [load, revision, effectiveRevision, queryKey]),
  );

  return { value, loading, error, refresh: () => setRevision((n) => n + 1) };
}

export function useFocusedList<T>(
  load: (offset: number) => Promise<T[]>,
  options?: LocalQueryOptions,
) {
  const revisionContext = options?.context ?? QueryRevisionContext;
  const dataRevision = useContext(revisionContext);
  const extraRevision = options?.extraRevision ?? 0;
  const effectiveRevision = dataRevision + extraRevision;
  const queryKey = options?.queryKey;

  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);

  const generation = useRef(0);
  const paging = useRef(false);
  const lastKeyRef = useRef<string | undefined>(queryKey);
  const hasLoadedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      paging.current = false;
      const keyChanged = lastKeyRef.current !== queryKey;
      lastKeyRef.current = queryKey;

      if (keyChanged) {
        setItems([]);
        hasLoadedRef.current = false;
        setLoading(true);
      } else if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setLoadingMore(false);
      setError(false);

      void load(0)
        .then(
          (result) => {
            if (generation.current !== current) return;
            setItems(result);
            hasLoadedRef.current = true;
            setHasMore(result.length === 30);
          },
          () => {
            if (generation.current === current) setError(true);
          },
        )
        .finally(() => {
          if (generation.current === current) setLoading(false);
        });

      return () => {
        generation.current++;
      };
    }, [load, revision, effectiveRevision, queryKey]),
  );

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || paging.current) return;
    const current = generation.current;
    paging.current = true;
    setLoadingMore(true);
    try {
      const next = await load(items.length);
      if (generation.current !== current) return;
      setItems((previous) => [...previous, ...next]);
      setHasMore(next.length === 30);
    } catch {
      if (generation.current === current) setError(true);
    } finally {
      if (generation.current === current) {
        paging.current = false;
        setLoadingMore(false);
      }
    }
  }, [loading, hasMore, load, items.length]);

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh: () => setRevision((n) => n + 1),
  };
}
