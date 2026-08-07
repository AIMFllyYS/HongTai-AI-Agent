import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";

import { TopNotification } from "../components/TopNotification";
import type { AppNotification, NotificationInput } from "./notification-model";

interface NotificationContextValue {
  readonly show: (input: NotificationInput) => string;
  readonly dismiss: (id?: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: PropsWithChildren) {
  const [current, setCurrent] = useState<AppNotification>();
  const sequence = useRef(0);
  const show = useCallback((input: NotificationInput) => {
    const id = `notice-${++sequence.current}`;
    setCurrent({ ...input, id });
    return id;
  }, []);
  const dismiss = useCallback((id?: string) => {
    setCurrent((value) => (!id || value?.id === id ? undefined : value));
  }, []);
  const value = useMemo(() => ({ show, dismiss }), [dismiss, show]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <TopNotification notification={current} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("NotificationProvider is not mounted");
  return value;
}
