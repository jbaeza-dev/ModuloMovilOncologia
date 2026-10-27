import { QueryRevisionContext } from '../providers/QueryRevision';
import { useFocusEffect } from 'expo-router';
import { useCallback, useContext, useRef, useState } from 'react';

export function useFocusedValue<T>(load: () => Promise<T>, initial: T) {
  const dataRevision = useContext(QueryRevisionContext);
  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const hasLoadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setError(false);
      void load()
        .then(
          (result) => {
            if (active) {
              setValue(result);
              hasLoadedRef.current = true;
            }
          },
          () => {
            if (active) setError(true);
          },
        )
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [load, revision, dataRevision]),
  );
  return { value, loading, error, refresh: () => setRevision((n) => n + 1) };
}

export function useFocusedList<T>(load: (offset: number) => Promise<T[]>) {
  const dataRevision = useContext(QueryRevisionContext);
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const paging = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      paging.current = false;
      setItems([]);
      setLoading(true);
      setLoadingMore(false);
      setError(false);
      void load(0)
        .then(
          (result) => {
            if (generation.current !== current) return;
            setItems(result);
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
    }, [load, revision, dataRevision]),
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
