import { useEffect } from "react";

/** Sets document.title for the current route, restoring the previous
    title on unmount so navigating away doesn't leave it stale. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
