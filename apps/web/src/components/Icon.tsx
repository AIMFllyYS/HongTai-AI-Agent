import type { SVGProps } from "react";

export type IconName =
  | "arrow_back" | "analytics" | "aspect_ratio" | "auto_awesome" | "bookmark" | "bolt" | "business_center"
  | "camera" | "check_circle" | "chevron_right" | "chevron_down" | "chevron_up" | "close" | "comment"
  | "content_paste" | "download" | "error" | "expand" | "face" | "file" | "filter" | "folder" | "folder_open"
  | "folder_special" | "forum" | "grid" | "health_cross" | "heart" | "history" | "info" | "key" | "keyboard_voice"
  | "language" | "lightbulb" | "link" | "memory" | "movie" | "movie_edit" | "notifications" | "pending"
  | "play" | "publish" | "query_stats" | "record_voice_over" | "restaurant" | "rocket" | "search" | "self_improvement"
  | "settings" | "share" | "sparkle" | "sunny" | "sync" | "tune" | "update" | "upload" | "upload_file"
  | "video_file" | "video_library" | "visibility" | "voice" | "smart_toy" | "robot" | "logout";

const paths: Record<IconName, readonly string[]> = {
  arrow_back: ["M19 12H5", "m12 19-7-7 7-7"],
  analytics: ["M4 19V5h4v14H4Zm6 0V9h4v10h-4Zm6 0V3h4v16h-4Z"],
  aspect_ratio: ["M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"],
  auto_awesome: ["m12 3 1.3 4.1L17 8.5l-3.7 1.4L12 14l-1.3-4.1L7 8.5l3.7-1.4L12 3Z", "m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"],
  bookmark: ["M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3-6 3V4.5Z"],
  bolt: ["m13 2-9 12h7l-1 8 9-12h-7l1-8Z"],
  business_center: ["M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2", "M4 7h16v12H4z", "M9 12h6"],
  camera: ["M4 7h3l1.5-2h7L17 7h3v12H4z", "M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"],
  check_circle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m8 12 2.5 2.5L16 9"],
  chevron_right: ["m9 5 7 7-7 7"],
  chevron_down: ["m6 9 6 6 6-6"],
  chevron_up: ["m6 15 6-6 6 6"],
  close: ["M6 6l12 12M18 6 6 18"],
  comment: ["M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-5 4v-4.3a2.5 2.5 0 0 1-2-2.4v-7Z"],
  content_paste: ["M8 5V3h8v2", "M6 5H4v16h16V5h-2", "M8 10h8M8 14h6"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M4 20h16"],
  error: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v6M12 16.5v.1"],
  expand: ["m8 3-5 5m5-5H3v5M16 3l5 5m-5-5h5v5M8 21l-5-5m5 5H3v-5m13 5 5-5m-5 5h5v-5"],
  face: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 10h.1M15.4 10h.1M8 15c1.1 1 2.3 1.5 4 1.5s2.9-.5 4-1.5"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v5h5"],
  filter: ["M4 5h16l-6 7v5l-4 2v-7L4 5Z"],
  folder: ["M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z"],
  folder_open: ["M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v1", "M3 10h18l-2 8H5l-2-8Z"],
  folder_special: ["M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z", "m12 9 .8 1.8 2 .2-1.5 1.4.4 2-1.7-1-1.7 1 .4-2-1.5-1.4 2-.2L12 9Z"],
  forum: ["M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-5 4v-4.3a2.5 2.5 0 0 1-2-2.4v-7Z", "M8 8h8M8 11h5"],
  grid: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"],
  health_cross: ["M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"],
  heart: ["M20.8 8.7c0 5.4-8.8 10.1-8.8 10.1S3.2 14.1 3.2 8.7A4.7 4.7 0 0 1 12 6a4.7 4.7 0 0 1 8.8 2.7Z"],
  history: ["M4 12a8 8 0 1 0 2.3-5.7", "M4 5v5h5", "M12 8v4l2.5 1.5"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 11v5M12 8.2v.1"],
  key: ["M14.5 9.5a4 4 0 1 1-7 2.5A4 4 0 0 1 14.5 9.5Z", "m13 11 7-7M17 4l3 3M15 6l3 3"],
  keyboard_voice: ["M8 11a4 4 0 0 0 8 0V7a4 4 0 0 0-8 0v4Z", "M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"],
  language: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"],
  lightbulb: ["M9 18h6M10 21h4", "M8 14a6 6 0 1 1 8 0c-.8.7-1 1.7-1 3H9c0-1.3-.2-2.3-1-3Z"],
  link: ["M9 15 7.5 16.5a3.5 3.5 0 0 1-5-5L5 9", "m15 9 1.5-1.5a3.5 3.5 0 0 1 5 5L19 15", "m7 12h10"],
  memory: ["M6 6h12v12H6z", "M9 9h6v6H9z", "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"],
  movie: ["M4 6h16v12H4z", "M4 9h16M8 6v3M12 6v3M16 6v3"],
  movie_edit: ["M4 6h13v12H4z", "M4 9h13M8 6v3M12 6v3", "m17 16 3-3 2 2-3 3-3 1Z"],
  notifications: ["M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  pending: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  play: ["m9 6 9 6-9 6V6Z"],
  publish: ["M5 5h14v14H5z", "M8 12h8M12 8v8"],
  query_stats: ["M4 19V5M4 19h16", "m7 15 3-4 3 2 4-6"],
  record_voice_over: ["M8 11a4 4 0 0 0 8 0V7a4 4 0 0 0-8 0v4Z", "M5 11a7 7 0 0 0 14 0M12 18v3", "M17 17h4M19 15v4"],
  restaurant: ["M7 3v7M4 3v4a3 3 0 0 0 6 0V3M7 10v11", "M16 3v18M16 3c3 2 4 5 0 9"],
  rocket: ["M14 4c2.5-2.5 6-2 6-2s.5 3.5-2 6l-5 5-3-3 4-6Z", "m10 10-4 1-3 3 5 1 1 5 3-3 1-4", "M7 17c-1 2-3 3-4 3 0-1 1-3 3-4"],
  search: ["M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z", "m16 16 5 5"],
  self_improvement: ["M12 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M5 21c1-5 3-8 7-8s6 3 7 8", "M4 10h5M15 10h5"],
  settings: ["M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z", "M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-1.8 1.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V20h-2.6v-.1a1.8 1.8 0 0 0-1.1-1.7 1.8 1.8 0 0 0-2 .4l-.1.1-1.8-1.8.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1.1H6V11h.1a1.8 1.8 0 0 0 1.7-1.1 1.8 1.8 0 0 0-.4-2l-.1-.1 1.8-1.8.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 12.3 5V4h2.6v1a1.8 1.8 0 0 0 1.1 1.6 1.8 1.8 0 0 0 2-.4l.1-.1 1.8 1.8-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1.1h.9v2.6h-.9a1.8 1.8 0 0 0-1.7 1.3Z"],
  share: ["M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"],
  sparkle: ["m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z"],
  sunny: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"],
  sync: ["M20 11a8 8 0 0 0-14.8-4L3 9", "M3 4v5h5", "M4 13a8 8 0 0 0 14.8 4L21 15", "M21 20v-5h-5"],
  tune: ["M4 7h16M4 17h16", "M8 5v4M16 15v4"],
  update: ["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v6h-6", "M12 8v4l2.5 1.5"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M4 20h16"],
  upload_file: ["M6 3h8l4 4v14H6z", "M14 3v5h5", "M12 17V11", "m9 14 3-3 3 3"],
  video_file: ["M5 3h10l4 4v14H5z", "M15 3v5h5", "m9 12 4 2-4 2v-4Z"],
  video_library: ["M4 5h15v14H4z", "M7 8h9M7 11h9M7 14h5", "m19 8 2-1v10l-2 1"],
  visibility: ["M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  voice: ["M8 11a4 4 0 0 0 8 0V7a4 4 0 0 0-8 0v4Z", "M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"],
  smart_toy: ["M7 8h10a3 3 0 0 1 3 3v6H4v-6a3 3 0 0 1 3-3Z", "M9 13h.1M15 13h.1M12 8V5M9 5h6", "M2 12h2M20 12h2"],
  robot: ["M7 8h10a3 3 0 0 1 3 3v6H4v-6a3 3 0 0 1 3-3Z", "M9 13h.1M15 13h.1M12 8V5M9 5h6", "M2 12h2M20 12h2"],
  logout: ["M10 5H5v14h5", "m14 8 4 4-4 4M9 12h9"],
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  readonly name: IconName;
  readonly size?: number;
  readonly label?: string;
}

export function Icon({ name, size = 24, label, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      fill="none"
      height={size}
      role={label ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name].map((path) => <path d={path} key={path} />)}
    </svg>
  );
}
