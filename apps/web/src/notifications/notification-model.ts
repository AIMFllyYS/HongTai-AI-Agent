export type NotificationLevel = "success" | "info" | "warning" | "error";

export interface NotificationAction {
  readonly label: string;
  readonly onPress: () => void;
}

export interface NotificationInput {
  readonly level: NotificationLevel;
  readonly title: string;
  readonly message?: string;
  readonly technicalCode?: string;
  readonly action?: NotificationAction;
}

export interface AppNotification extends NotificationInput {
  readonly id: string;
}

export const NOTIFICATION_VISIBLE_MS = 5_000;
export const NOTIFICATION_DISMISS_DISTANCE_PX = 36;
export const NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND = 450;

export function shouldDismissNotification(deltaY: number, velocityY: number): boolean {
  return deltaY < -NOTIFICATION_DISMISS_DISTANCE_PX
    || velocityY < -NOTIFICATION_DISMISS_VELOCITY_PX_PER_SECOND;
}

export function notificationOpacity(deltaY: number): number {
  if (deltaY >= 0) return 1;
  return Math.max(0.25, 1 - Math.abs(deltaY) / 120);
}
