import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

import { PausableCountdown } from "../notifications/notification-countdown";
import {
  NOTIFICATION_VISIBLE_MS,
  notificationOpacity,
  shouldDismissNotification,
  type AppNotification,
  type NotificationLevel,
} from "../notifications/notification-model";
import { Icon } from "./Icon";

const iconForLevel: Readonly<Record<NotificationLevel, "check_circle" | "info" | "error">> = {
  success: "check_circle",
  info: "info",
  warning: "error",
  error: "error",
};

export interface TopNotificationProps {
  readonly notification?: AppNotification;
  readonly onDismiss: (id?: string) => void;
}

export function TopNotification({ notification, onDismiss }: TopNotificationProps) {
  const reducedMotion = useReducedMotion();
  const countdown = useRef<PausableCountdown | undefined>(undefined);
  const dragY = useMotionValue(0);
  const dragOpacity = useTransform(dragY, notificationOpacity);

  useEffect(() => {
    if (!notification) return undefined;
    dragY.set(0);
    const next = new PausableCountdown(NOTIFICATION_VISIBLE_MS, () => onDismiss(notification.id));
    countdown.current = next;
    next.start();
    return () => {
      next.dispose();
      countdown.current = undefined;
    };
  }, [dragY, notification, onDismiss]);

  const runAction = () => {
    if (!notification?.action) return;
    try {
      notification.action.onPress();
    } finally {
      onDismiss(notification.id);
    }
  };

  return (
    <AnimatePresence>
      {notification ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="top-notification-viewport"
          exit={{ opacity: 0, y: reducedMotion ? -8 : "-140%" }}
          initial={{ opacity: 0, y: reducedMotion ? -8 : "-140%" }}
          key={notification.id}
          transition={{ duration: reducedMotion ? 0.14 : 0.4, ease: [0.22, 0.86, 0.28, 1] }}
        >
          <motion.aside
            aria-live={notification.level === "error" ? "assertive" : "polite"}
            className={`top-notification top-notification--${notification.level}`}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 1, bottom: 0.12 }}
            onDragEnd={(_event, info) => {
              if (shouldDismissNotification(info.offset.y, info.velocity.y)) {
                onDismiss(notification.id);
                return;
              }
              void animate(dragY, 0, { type: "spring", stiffness: 520, damping: 38 });
              countdown.current?.resume();
            }}
            onDragStart={() => countdown.current?.pause()}
            role={notification.level === "error" ? "alert" : "status"}
            style={{ opacity: dragOpacity, y: dragY }}
          >
            <span className="top-notification__icon">
              <Icon name={iconForLevel[notification.level]} size={19} />
            </span>
            <span className="top-notification__copy">
              <strong>{notification.title}</strong>
              {notification.message ? <small>{notification.message}</small> : null}
            </span>
            {notification.action ? (
              <button
                className="top-notification__action"
                onClick={runAction}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                {notification.action.label}
              </button>
            ) : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
