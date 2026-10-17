type ScrollListener = () => void;

let pendingScrollToTop = false;
const listeners = new Set<ScrollListener>();

export function requestHomeScrollToTop(): void {
  pendingScrollToTop = true;
  listeners.forEach((listener) => listener());
}

export function consumeHomeScrollToTop(): boolean {
  if (!pendingScrollToTop) return false;
  pendingScrollToTop = false;
  return true;
}

export function clearHomeScrollToTop(): void {
  pendingScrollToTop = false;
}

export function subscribeHomeScrollToTop(listener: ScrollListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
