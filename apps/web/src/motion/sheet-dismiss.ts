export const SHEET_DISMISS_DISTANCE_PX = 80;
export const SHEET_DISMISS_VELOCITY_PX_PER_SECOND = 450;

export function shouldDismissSheet(deltaY: number, velocityY: number): boolean {
  return deltaY > SHEET_DISMISS_DISTANCE_PX || velocityY > SHEET_DISMISS_VELOCITY_PX_PER_SECOND;
}
