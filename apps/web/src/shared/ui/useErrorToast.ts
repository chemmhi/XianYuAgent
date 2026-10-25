import { useEffect } from 'react';
import { useToast } from './ToastProvider';

/** Clear stale request feedback when its source resets, succeeds or unmounts. */
export function useErrorToast(error: string | null, id: string) {
  const { showToast, dismissToast } = useToast();
  useEffect(() => {
    if (!error) return;
    showToast({ id, message: error, tone: 'error' });
    return () => dismissToast(id);
  }, [error, id, showToast, dismissToast]);
}
