import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function usePayoutStatus() {
  const { user } = useAuth();
  const [payoutsEnabled, setPayoutsEnabled] = useState(false);
  const [isChecking, setIsChecking] = useState(Boolean(user));

  useEffect(() => {
    if (!user) {
      setPayoutsEnabled(false);
      setIsChecking(false);
      return;
    }
    const controller = new AbortController();
    setIsChecking(true);
    fetch('/api/profile', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => ({ response, data: await response.json().catch(() => null) }))
      .then(({ response, data }) => {
        if (!controller.signal.aborted) {
          setPayoutsEnabled(Boolean(response.ok && data?.success && data?.user?.payoutsEnabled));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPayoutsEnabled(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsChecking(false);
      });
    return () => controller.abort();
  }, [user?.id]);

  return { payoutsEnabled, isChecking };
}
