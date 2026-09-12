import { useState, useCallback } from 'react';

export function useToasts() {
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const say = useCallback((m: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg: m, kind });
    setTimeout(() => setToast(null), 1900);
  }, []);

  return { toast, say };
}
