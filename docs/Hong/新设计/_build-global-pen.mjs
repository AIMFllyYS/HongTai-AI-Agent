/**
 * Generates docs/Hong/新设计/hongtai-mobile.pen from the current apps/web page layer.
 * Visual tokens stay as-is; screens, copy and routes must match the live UI.
 * Run: node docs/Hong/新设计/_build-global-pen.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const outPath = join(dir, "hongtai-mobile.pen");

let seq = 0;
const id = () => `h${(++seq).toString(36).padStart(4, "0")}`;

const ICONS = {
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
  list: ["M9 6h11M9 12h11M9 18h11", "M4.5 6h.1M4.5 12h.1M4.5 18h.1"],
  add: ["M12 5v14M5 12h14"],
  remove: ["M5 12h14"],
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
  more_vert: ["M12 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 20.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"],
};

function frame(name, props, children = []) {
  const node = { type: "frame", id: id(), name, ...props };
  if (children.length) node.children = children;
  return node;
}

function txt(name, content, o = {}) {
  const n = {
    type: "text",
    id: id(),
    name,
    content,
    fill: o.fill ?? "$text-primary",
    fontFamily: o.font ?? "$font-body",
    fontSize: o.size ?? 16,
    fontWeight: String(o.weight ?? 400),
  };
  if (o.lh) n.lineHeight = o.lh;
  if (o.ls != null) n.letterSpacing = o.ls;
  n.textGrowth = o.growth ?? "auto";
  if (o.width != null) n.width = o.width;
  if (o.height != null) n.height = o.height;
  if (o.align) n.textAlign = o.align;
  if (o.valign) n.textAlignVertical = o.valign;
  return n;
}

function wrapText(name, content, width, o = {}) {
  return txt(name, content, { ...o, growth: "fixed-width", width });
}

const PHONE_W = 390;
const PHONE_H = 844;
const SCREEN_GAP = 80;
const SECTION_GAP = 120;

function icon(name, size, color) {
  const geoms = ICONS[name];
  if (!geoms) throw new Error(`missing icon ${name}`);
  return frame(`icon/${name}`, { width: size, height: size, layout: "none" }, geoms.map((geometry, i) => ({
    type: "path",
    id: id(),
    name: `${name}-${i}`,
    x: 0,
    y: 0,
    width: size,
    height: size,
    geometry,
    viewBox: [0, 0, 24, 24],
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "#00000000",
  })));
}

function cardShadow() {
  return { type: "shadow", shadowType: "outer", offset: { x: 0, y: 4 }, blur: 12, color: "#004D400A" };
}
function floatShadow() {
  return { type: "shadow", shadowType: "outer", offset: { x: 0, y: 12 }, blur: 28, color: "#004D401A" };
}
function navShadow() {
  return { type: "shadow", shadowType: "outer", offset: { x: 0, y: -4 }, blur: 12, color: "#004D400A" };
}
function glassBlur() {
  return { type: "background_blur", radius: 20 };
}

const C = {};
const D = {};

function button({ name, label, variant, iconName, size = "md", width }) {
  const styles = {
    primary: { fill: "$action-primary", text: "$text-on-primary", icon: "$text-on-primary", effect: floatShadow() },
    secondary: { fill: "$accent-soft", text: "$action-primary", icon: "$action-primary" },
    "secondary-warm": { fill: "$surface-vitality-low", text: "$action-primary", icon: "$action-primary" },
    ghost: { fill: "#00000000", text: "$action-primary", icon: "$action-primary", stroke: "$action-primary" },
    quiet: { fill: "$surface-container", text: "$text-subtle", icon: "$text-subtle" },
    busy: { fill: { type: "gradient", gradientType: "linear", rotation: 225, colors: [{ color: "#80d5be", position: 0 }, { color: "#55b69f", position: 1 }] }, text: "#000000", icon: "#000000", effect: { type: "shadow", shadowType: "outer", offset: { x: 0, y: 6 }, blur: 16, color: "#004D4024" } },
  };
  const s = styles[variant];
  const h = size === "lg" ? 56 : 48;
  const node = frame(name, {
    layout: "horizontal",
    height: h,
    padding: size === "lg" ? [12, 24] : [12, 20],
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    fill: s.fill,
    cornerRadius: 999,
    effect: s.effect,
  }, [
    ...(iconName ? [icon(iconName, size === "lg" ? 19 : 17, s.icon)] : []),
    txt("Label", label, { size: size === "lg" ? 18 : 16, weight: 600, fill: s.text, font: "$font-display" }),
  ]);
  if (width) node.width = width;
  if (s.stroke) {
    node.stroke = s.stroke;
    node.strokeWidth = 1;
  }
  return node;
}

function badge(status, compact = false) {
  const map = {
    completed: { fill: "$status-success-soft", color: "$status-success", label: "已完成" },
    processing: { fill: "$status-progress-soft", color: "$status-progress", label: "进行中" },
    pending: { fill: "$status-warning-soft", color: "$status-warning", label: "待处理" },
    failed: { fill: "$status-error-soft", color: "$status-error", label: "未完成" },
    neutral: { fill: "$surface-container", color: "$text-subtle", label: "本地" },
  };
  const s = map[status];
  return frame(`Badge/${s.label}`, {
    layout: "horizontal",
    padding: compact ? [2, 8] : [4, 10],
    gap: 4,
    alignItems: "center",
    fill: s.fill,
    cornerRadius: 999,
  }, [txt("Badge Label", s.label, { size: 13, weight: 600, fill: s.color, lh: 1 })]);
}

function statusBar() {
  return frame("Status Bar", {
    width: 390,
    height: 24,
    layout: "horizontal",
    padding: [0, 16],
    justifyContent: "space_between",
    alignItems: "center",
    fill: "#00000000",
  }, [
    txt("Time", "9:41", { size: 12, weight: 600, fill: "$text-primary" }),
    frame("Indicators", { layout: "horizontal", gap: 6, alignItems: "center" }, [
      icon("analytics", 12, "$text-primary"),
      txt("Battery", "100%", { size: 11, weight: 500, fill: "$text-primary" }),
    ]),
  ]);
}

function brandMark(w = 50, h = 33) {
  return frame("Brand Mark", {
    width: w,
    height: h,
    fill: { type: "image", url: "./assets/pulse-flow-mark.png", mode: "fit" },
  });
}

function headerBrand(title, right) {
  return frame("App Header / Brand", {
    width: 390,
    height: 56,
    layout: "horizontal",
    padding: [8, 16],
    gap: 12,
    alignItems: "center",
    fill: "$glass-fill",
    stroke: "#BFC9C44D",
    strokeWidth: { bottom: 1 },
    effect: [glassBlur(), { type: "shadow", shadowType: "outer", offset: { x: 0, y: 4 }, blur: 16, color: "#004D4009" }],
  }, [
    brandMark(),
    frame("Title Wrap", { layout: "vertical", width: "fill_container" }, [
      wrapText("Title", title, "fill_container", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.44 }),
    ]),
    right ?? frame("Header Action Slot", { width: 40, height: 40 }),
  ]);
}

function headerDetail(title, right, subtitle) {
  const titleNode = subtitle
    ? frame("Title Wrap", { layout: "vertical", width: "fill_container", gap: 0, alignItems: "center" }, [
      wrapText("Title", title, "fill_container", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.2, align: "center" }),
      wrapText("Subtitle", subtitle, "fill_container", { size: 12, fill: "$text-muted", lh: 1.3, align: "center" }),
    ])
    : wrapText("Title", title, "fill_container", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.44, align: "center" });
  return frame("App Header / Detail", {
    width: 390,
    height: 56,
    layout: "horizontal",
    padding: [8, 16],
    gap: 8,
    alignItems: "center",
    fill: "$glass-fill",
    stroke: "#BFC9C44D",
    strokeWidth: { bottom: 1 },
    effect: [glassBlur(), { type: "shadow", shadowType: "outer", offset: { x: 0, y: 4 }, blur: 16, color: "#004D4009" }],
  }, [
    frame("Back", { width: 40, height: 40, layout: "horizontal", alignItems: "center", justifyContent: "center", cornerRadius: 999 }, [
      icon("arrow_back", 25, "$action-primary"),
    ]),
    titleNode,
    right ?? frame("Header Action Slot", { width: 40, height: 40, layout: "horizontal", alignItems: "center", justifyContent: "center" }, [
      icon("more_vert", 22, "$action-primary"),
    ]),
  ]);
}

function navItem(idKey, label, iconName, active, warm) {
  const color = active ? (warm ? "$accent" : "$action-primary") : "$text-subtle";
  const wrapFill = active ? (warm ? "$surface-vitality-low" : "$accent-soft") : "#00000000";
  return frame(`Nav/${label}`, {
    layout: "vertical",
    width: "fill_container",
    gap: 2,
    alignItems: "center",
    justifyContent: "center",
  }, [
    frame(`Nav/${label} Icon Wrap`, {
      width: 40,
      height: 32,
      layout: "horizontal",
      alignItems: "center",
      justifyContent: "center",
      fill: wrapFill,
      cornerRadius: 999,
    }, [icon(iconName, 22, color)]),
    txt(`Nav/${label} Label`, label, { size: 13, weight: active ? 600 : 400, fill: color, lh: 1 }),
  ]);
}

function bottomNav(active, warm = false) {
  const items = [
    ["ai", "AI", "health_cross"],
    ["home", "拆解", "analytics"],
    ["create", "制作", "movie_edit"],
    ["templates", "模板", "content_paste"],
    ["settings", "设置", "settings"],
  ];
  return frame("Bottom Nav", {
    width: 390,
    height: 64,
    layout: "horizontal",
    padding: [8, 8],
    fill: warm ? "#FBFDFAF0" : "#F8FAF7E6",
    stroke: "#BFC9C44D",
    strokeWidth: { top: 1 },
    effect: [glassBlur(), navShadow()],
  }, items.map(([key, label, ic]) => navItem(key, label, ic, key === active, warm)));
}

function glassCard(name, children, extra = {}) {
  return frame(name, {
    layout: "vertical",
    width: "fill_container",
    fill: extra.fill ?? "$surface-card",
    stroke: extra.stroke ?? "#BFC9C46B",
    strokeWidth: 1,
    cornerRadius: extra.radius ?? 16,
    effect: cardShadow(),
    padding: extra.padding ?? 20,
    gap: extra.gap ?? 16,
    ...extra.rest,
  }, children);
}

function tabs(items, active) {
  return frame("Tabs", {
    layout: "horizontal",
    width: "fill_container",
    gap: 20,
    stroke: "$outline-soft",
    strokeWidth: { bottom: 1 },
  }, items.map((label) => {
    const on = label === active;
    return frame(`Tab/${label}`, {
      layout: "vertical",
      padding: [9, 2, 11, 2],
      gap: 0,
    }, [
      txt(`Tab/${label} Label`, label, { size: 12.5, weight: 600, fill: on ? "$action-primary" : "$text-muted" }),
      frame(`Tab/${label} Underline`, { width: "fill_container", height: 2, fill: on ? "$accent" : "#00000000", cornerRadius: 999 }),
    ]);
  }));
}

function inputField(placeholder, value) {
  return frame("Input Control", {
    layout: "horizontal",
    width: "fill_container",
    height: 48,
    padding: [0, 12],
    gap: 8,
    alignItems: "center",
    fill: "$surface-low",
    stroke: "$outline",
    strokeWidth: 1,
    cornerRadius: 12,
  }, [
    wrapText("Value", value || placeholder, "fill_container", { size: 14, fill: value ? "$text-subtle" : "$text-muted" }),
    frame("Paste", { width: 32, height: 32, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "$status-progress-soft", cornerRadius: 12 }, [
      icon("content_paste", 18, "$status-progress"),
    ]),
  ]);
}

function taskRow(title, meta, status) {
  return frame("Task History Row", {
    layout: "horizontal",
    width: "fill_container",
    padding: 12,
    gap: 12,
    alignItems: "center",
    fill: "$surface-card",
    stroke: "$outline-soft",
    strokeWidth: 1,
    cornerRadius: 12,
    effect: cardShadow(),
  }, [
    frame("Row Icon", { width: 39, height: 39, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "$accent-soft", cornerRadius: 12 }, [
      icon("video_file", 19, "$action-primary"),
    ]),
    frame("Row Body", { layout: "vertical", width: "fill_container", gap: 3 }, [
      wrapText("Row Title", title, "fill_container", { size: 13, fill: "$text-subtle", lh: 1.35 }),
      wrapText("Row Meta", meta, "fill_container", { size: 12, fill: "$text-muted", lh: 1.35 }),
    ]),
    badge(status, true),
    icon("chevron_right", 18, "$text-muted"),
  ]);
}

function settingsRow(ic, title, sub, keyTone = false) {
  return frame("Settings Row", {
    layout: "horizontal",
    width: "fill_container",
    height: 68,
    padding: [12, 16],
    gap: 12,
    alignItems: "center",
  }, [
    frame("Row Icon", {
      width: 36,
      height: 36,
      layout: "horizontal",
      alignItems: "center",
      justifyContent: "center",
      fill: keyTone ? "$status-warning-soft" : "$accent-soft",
      cornerRadius: 10,
    }, [icon(ic, 19, keyTone ? "$status-warning" : "$action-primary")]),
    frame("Row Body", { layout: "vertical", width: "fill_container", gap: 2 }, [
      wrapText("Row Title", title, "fill_container", { size: 14, weight: 600, fill: "$text-subtle", lh: 1.25 }),
      wrapText("Row Sub", sub, "fill_container", { size: 12, fill: "$text-muted", lh: 1.5 }),
    ]),
    icon("chevron_right", 17, "$text-muted"),
  ]);
}

function progressStep(title, status, detail, last = false) {
  const color = status === "done" ? "$status-success" : status === "run" ? "$status-progress" : "$text-muted";
  const ic = status === "done" ? "check_circle" : status === "run" ? "sync" : "pending";
  const label = status === "done" ? "已完成" : status === "run" ? "进行中" : "等待中";
  return frame(`Step/${title}`, {
    layout: "horizontal",
    width: "fill_container",
    gap: 12,
  }, [
    frame("Marker Col", { layout: "vertical", alignItems: "center", gap: 0 }, [
      frame("Marker", { width: 28, height: 28, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "$surface-paper", cornerRadius: 999 }, [
        icon(ic, 18, color),
      ]),
      last ? null : frame("Rail", { width: 1, height: 28, fill: "$outline-soft" }),
    ].filter(Boolean)),
    frame("Step Body", { layout: "vertical", width: "fill_container", gap: 4, padding: [0, 0, last ? 0 : 8, 0] }, [
      frame("Step Line", { layout: "horizontal", width: "fill_container", justifyContent: "space_between", alignItems: "center" }, [
        wrapText("Step Title", title, "fill_container", { size: 14, weight: 500, fill: status === "run" ? "$action-primary" : "$text-subtle" }),
        txt("Step Status", label, { size: 13, weight: status === "run" ? 600 : 400, fill: color }),
      ]),
      wrapText("Step Detail", detail, "fill_container", { size: 13, fill: "$text-muted", lh: 1.35 }),
    ]),
  ]);
}

function emptyState(ic, title, desc) {
  return frame("Empty State", {
    layout: "vertical",
    width: "fill_container",
    padding: [32, 24],
    gap: 8,
    alignItems: "center",
  }, [
    icon(ic, 36, "$accent"),
    txt("Empty Title", title, { size: 16, weight: 600, fill: "$text-primary", font: "$font-display" }),
    wrapText("Empty Desc", desc, 280, { size: 13, fill: "$text-muted", align: "center", lh: 1.5 }),
  ]);
}

function fieldLabel(ic, label) {
  return frame("Field Label", { layout: "horizontal", gap: 8, alignItems: "center" }, [
    icon(ic, 20, "$text-subtle"),
    txt("Label Text", label, { size: 13, weight: 600, fill: "$text-subtle" }),
  ]);
}

function eyebrow(text) {
  return txt("Eyebrow", text, { size: 12, weight: 700, fill: "$accent", ls: 1.6, font: "$font-data" });
}

function sectionHead(title, extra) {
  return frame("Section Heading", {
    layout: "horizontal",
    width: "fill_container",
    justifyContent: "space_between",
    alignItems: "center",
    gap: 12,
  }, [
    txt("Section Title", title, { size: 16, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.5 }),
    extra,
  ].filter(Boolean));
}

function ctaBar(node) {
  return frame("Contextual Action", {
    width: 358,
    layout: "vertical",
    alignItems: "center",
  }, [node]);
}

function headerIcon(iconName, title, right) {
  return frame("App Header / Icon", {
    width: 390,
    height: 56,
    layout: "horizontal",
    padding: [8, 16],
    gap: 8,
    alignItems: "center",
    fill: "$glass-fill",
    stroke: "#BFC9C44D",
    strokeWidth: { bottom: 1 },
    effect: [glassBlur(), { type: "shadow", shadowType: "outer", offset: { x: 0, y: 4 }, blur: 16, color: "#004D4009" }],
  }, [
    frame("Page Icon", { width: 40, height: 40, layout: "horizontal", alignItems: "center", justifyContent: "center" }, [
      icon(iconName, 24, "$action-primary"),
    ]),
    frame("Title Wrap", { layout: "vertical", width: "fill_container" }, [
      wrapText("Title", title, "fill_container", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.44 }),
    ]),
    right ?? frame("Header Action Slot", { width: 40, height: 40 }),
  ]);
}

function phoneHeader(mode, title, right, iconName, subtitle) {
  if (mode === "detail") return headerDetail(title, right, subtitle);
  if (mode === "icon") return headerIcon(iconName, title, right);
  return headerBrand(title, right);
}

function phone({ name, title, mode = "brand", iconName, active, warm = false, right, content, cta, ctaHeight = 56, subtitle }) {
  const navH = 64;
  const contentH = PHONE_H - 80 - navH;
  return frame(name, {
    width: PHONE_W,
    height: PHONE_H,
    clip: true,
    layout: "none",
    fill: warm ? "$surface-paper" : "$surface-canvas",
    stroke: "$outline-soft",
    strokeWidth: 1,
  }, [
    Object.assign(statusBar(), { x: 0, y: 0, layoutPosition: "absolute" }),
    Object.assign(phoneHeader(mode, title, right, iconName, subtitle), { x: 0, y: 24, layoutPosition: "absolute" }),
    frame("Screen Content", {
      x: 0,
      y: 80,
      layoutPosition: "absolute",
      width: PHONE_W,
      height: contentH,
      clip: true,
      layout: "vertical",
      gap: 24,
      padding: [24, 16, cta ? ctaHeight + 24 : 24, 16],
    }, content),
    ...(cta ? [Object.assign(cta, { x: 16, y: PHONE_H - navH - 12 - ctaHeight, layoutPosition: "absolute" })] : []),
    Object.assign(bottomNav(active, warm), { x: 0, y: PHONE_H - navH, layoutPosition: "absolute" }),
  ]);
}

function deviceColumn(label, device) {
  return frame(`Col / ${device.name}`, {
    layout: "vertical",
    width: PHONE_W,
    gap: 12,
  }, [
    txt("Caption", label, { size: 13, weight: 600, fill: "$text-muted", width: PHONE_W, growth: "fixed-width" }),
    device,
  ]);
}

function screenSection(name, x, y, kicker, title, devices) {
  const width = devices.length * PHONE_W + (devices.length - 1) * SCREEN_GAP;
  return frame(name, {
    x,
    y,
    width,
    layout: "vertical",
    gap: 20,
  }, [
    colOf("Section Intro", 6, [
      eyebrow(kicker),
      txt("Section Title", title, { size: 20, weight: 700, fill: "$forest-950", font: "$font-display" }),
    ], { width: 720 }),
    frame("Devices", {
      layout: "horizontal",
      width: "fill_container",
      gap: SCREEN_GAP,
      alignItems: "start",
    }, devices),
  ]);
}

function swatch(name, token, hex) {
  return frame(name, { layout: "vertical", gap: 8, width: 120 }, [
    frame("Chip", { width: 120, height: 72, fill: token, cornerRadius: 12, stroke: "#BFC9C433", strokeWidth: 1 }),
    txt("Name", name, { size: 12, weight: 700, fill: "$text-primary" }),
    txt("Value", hex, { size: 11, fill: "$text-muted", font: "$font-data" }),
  ]);
}

function typeRow(name, sample, size, weight, lh, ls) {
  return frame(name, {
    layout: "vertical",
    width: "fill_container",
    gap: 6,
    padding: [16, 0],
    stroke: "$outline-soft",
    strokeWidth: { bottom: 1 },
  }, [
    frame("Meta", { layout: "horizontal", width: "fill_container", justifyContent: "space_between" }, [
      txt("Token", name, { size: 12, weight: 700, fill: "$accent", font: "$font-data", ls: 1 }),
      txt("Spec", `${size} / ${weight} / LH ${lh}`, { size: 12, fill: "$text-muted", font: "$font-data" }),
    ]),
    wrapText("Sample", sample, "fill_container", { size, weight, lh, ls, fill: "$text-primary", font: "$font-display" }),
  ]);
}

function radiusDemo(name, r) {
  return frame(name, { layout: "vertical", gap: 8, alignItems: "center" }, [
    frame("Shape", { width: 72, height: 56, fill: "$accent-soft", stroke: "$action-primary", strokeWidth: 1, cornerRadius: r }),
    txt("R Name", name, { size: 12, weight: 600, fill: "$text-primary" }),
    txt("R Value", `${r}px`, { size: 11, fill: "$text-muted", font: "$font-data" }),
  ]);
}

function spaceDemo(name, px) {
  return frame(name, { layout: "horizontal", gap: 12, alignItems: "center", width: "fill_container" }, [
    txt("S Name", name, { size: 12, weight: 600, fill: "$text-subtle", width: 72, growth: "fixed-width" }),
    frame("Bar", { width: px, height: 12, fill: "$action-primary", cornerRadius: 4 }),
    txt("S Value", `${px}px`, { size: 11, fill: "$text-muted", font: "$font-data" }),
  ]);
}

function iconTile(name) {
  return frame(`Icon Tile/${name}`, {
    layout: "vertical",
    width: 88,
    gap: 8,
    padding: 10,
    alignItems: "center",
    fill: "$surface-card",
    stroke: "$outline-soft",
    strokeWidth: 1,
    cornerRadius: 12,
  }, [
    icon(name, 22, "$action-primary"),
    wrapText("Icon Name", name, 68, { size: 10, fill: "$text-muted", align: "center" }),
  ]);
}

function rowOf(name, gap, children, extra = {}) {
  return frame(name, { layout: "horizontal", width: "fill_container", gap, alignItems: "start", ...extra }, children);
}

function colOf(name, gap, children, extra = {}) {
  return frame(name, { layout: "vertical", width: "fill_container", gap, ...extra }, children);
}

const variables = {
  "forest-950": { type: "color", value: "#00342B" },
  "deep-emerald": { type: "color", value: "#004D40" },
  accent: { type: "color", value: "#26A69A" },
  "primary-soft": { type: "color", value: "#7EBDAC" },
  mint: { type: "color", value: "#BBE9E1" },
  "action-primary": { type: "color", value: "#004D40" },
  "action-primary-hover": { type: "color", value: "#00342B" },
  "accent-soft": { type: "color", value: "#BBE9E1" },
  "text-primary": { type: "color", value: "#191C1B" },
  "text-on-primary": { type: "color", value: "#FFFFFF" },
  "text-subtle": { type: "color", value: "#3F4945" },
  "text-muted": { type: "color", value: "#707975" },
  "vitality-muted": { type: "color", value: "#606B66" },
  outline: { type: "color", value: "#BFC9C4" },
  "outline-soft": { type: "color", value: "#E0E7E3" },
  "surface-canvas": { type: "color", value: "#F8FAF7" },
  "surface-paper": { type: "color", value: "#FBFDFA" },
  "surface-card": { type: "color", value: "#FFFFFF" },
  "surface-low": { type: "color", value: "#F2F4F1" },
  "surface-vitality-low": { type: "color", value: "#F2F7F2" },
  "surface-container": { type: "color", value: "#ECEEEC" },
  "surface-high": { type: "color", value: "#E7E9E6" },
  "surface-pressed": { type: "color", value: "#E1E3E0" },
  "status-success": { type: "color", value: "#2E7D32" },
  "status-success-soft": { type: "color", value: "#DCFCE7" },
  "status-progress": { type: "color", value: "#00796B" },
  "status-progress-soft": { type: "color", value: "#D9F3EE" },
  "status-warning": { type: "color", value: "#B96100" },
  "status-warning-soft": { type: "color", value: "#FFEDD5" },
  "status-error": { type: "color", value: "#BA1A1A" },
  "status-error-soft": { type: "color", value: "#FFDAD6" },
  "glass-fill": { type: "color", value: "#F8FAF7D6" },
  "silk-white": { type: "color", value: "#FBFDFA" },
  "mint-whisper": { type: "color", value: "#F2F7F2" },
  "card-border": { type: "color", value: "#BFC9C46B" },
  "font-body": { type: "string", value: "Noto Sans SC" },
  "font-display": { type: "string", value: "Noto Sans SC" },
  "font-data": { type: "string", value: "Noto Sans SC" },
  "space-1": { type: "number", value: 4 },
  "space-2": { type: "number", value: 8 },
  "space-3": { type: "number", value: 12 },
  "space-4": { type: "number", value: 16 },
  "space-5": { type: "number", value: 20 },
  "space-6": { type: "number", value: 24 },
  "space-8": { type: "number", value: 32 },
  "space-10": { type: "number", value: 40 },
  "radius-sm": { type: "number", value: 4 },
  "radius-control": { type: "number", value: 12 },
  "radius-card": { type: "number", value: 16 },
  "radius-large": { type: "number", value: 24 },
  "radius-pill": { type: "number", value: 999 },
  "phone-width": { type: "number", value: 390 },
  "header-height": { type: "number", value: 56 },
  "nav-height": { type: "number", value: 64 },
  "gutter": { type: "number", value: 16 },
};

function buildCover() {
  return frame("A1 · 封面", {
    x: 0, y: 0, width: 1440, height: 420, clip: true, layout: "none",
    fill: {
      type: "gradient",
      gradientType: "linear",
      rotation: 240,
      colors: [
        { color: "#FBFDFA", position: 0 },
        { color: "#E8F4F0", position: 0.55 },
        { color: "#004D40", position: 1 },
      ],
    },
  }, [
    frame("Cover Content", {
      x: 64, y: 64, width: 1312, height: 292, layout: "horizontal", gap: 48, alignItems: "center",
    }, [
      frame("App Icon", {
        width: 120, height: 120, cornerRadius: 28, clip: true,
        fill: { type: "image", url: "./assets/hongtai-app-icon.png", mode: "fill" },
        effect: floatShadow(),
      }),
      colOf("Cover Copy", 16, [
        eyebrow("HONGTAI AI AGENT  ·  MOBILE DESIGN SYSTEM"),
        txt("Cover Title", "宏泰 AI 智能体", { size: 48, weight: 700, fill: "$forest-950", font: "$font-display", ls: -1, lh: 1.15 }),
        wrapText("Cover Sub", "按 v0.1.18 / versionCode 26 手机端真实页面层 1:1 复刻。色系、字体、组件与图标均来自 apps/web 的 tokens.css 与当前路由，不是示意稿。", 720, { size: 16, fill: "$text-subtle", lh: 1.6 }),
        rowOf("Cover Meta", 12, [
          frame("Chip v", { padding: [6, 12], fill: "$action-primary", cornerRadius: 999 }, [txt("v", "v0.1.18", { size: 12, weight: 700, fill: "#FFFFFF", font: "$font-data" })]),
          frame("Chip theme", { padding: [6, 12], fill: "$mint", cornerRadius: 999 }, [txt("t", "Warm Soft Tech × Profound Logic", { size: 12, weight: 600, fill: "$action-primary" })]),
          frame("Chip w", { padding: [6, 12], fill: "#FFFFFFCC", cornerRadius: 999 }, [txt("w", "390 × 844", { size: 12, weight: 600, fill: "$text-subtle", font: "$font-data" })]),
        ], { width: "fit_content" }),
      ], { width: 960 }),
    ]),
  ]);
}

function buildColors() {
  return frame("A2 · 色系", {
    x: 1520, y: 0, width: 1440, height: 920, clip: true, layout: "vertical",
    fill: "$surface-paper", padding: 48, gap: 28,
  }, [
    colOf("Intro", 8, [
      eyebrow("COLOR"),
      txt("H", "色系", { size: 32, weight: 700, fill: "$forest-950", font: "$font-display" }),
      wrapText("P", "来源：apps/web/src/styles/tokens.css。工作台主题用森林绿；观察页切到 Warm Soft Tech 的丝绸白与活力青绿。", 900, { size: 14, fill: "$text-muted", lh: 1.6 }),
    ]),
    wrapText("G1", "品牌与动作", 400, { size: 14, weight: 700, fill: "$action-primary" }),
    rowOf("Brand", 16, [
      swatch("Deep Emerald", "$deep-emerald", "#004D40"),
      swatch("Forest 950", "$forest-950", "#00342B"),
      swatch("Vitality Turquoise", "$accent", "#26A69A"),
      swatch("Primary Soft", "$primary-soft", "#7EBDAC"),
      swatch("Mint", "$mint", "#BBE9E1"),
    ]),
    wrapText("G2", "表面", 400, { size: 14, weight: 700, fill: "$action-primary" }),
    rowOf("Surfaces", 16, [
      swatch("Canvas", "$surface-canvas", "#F8FAF7"),
      swatch("Silk White", "$silk-white", "#FBFDFA"),
      swatch("Card", "$surface-card", "#FFFFFF"),
      swatch("Low", "$surface-low", "#F2F4F1"),
      swatch("Mint Whisper", "$mint-whisper", "#F2F7F2"),
      swatch("Container", "$surface-container", "#ECEEEC"),
    ]),
    wrapText("G3", "文字与描边", 400, { size: 14, weight: 700, fill: "$action-primary" }),
    rowOf("Text", 16, [
      swatch("Primary", "$text-primary", "#191C1B"),
      swatch("Subtle", "$text-subtle", "#3F4945"),
      swatch("Muted", "$text-muted", "#707975"),
      swatch("Outline", "$outline", "#BFC9C4"),
      swatch("Outline Soft", "$outline-soft", "#E0E7E3"),
    ]),
    wrapText("G4", "状态", 400, { size: 14, weight: 700, fill: "$action-primary" }),
    rowOf("Status", 16, [
      swatch("Success", "$status-success", "#2E7D32"),
      swatch("Success Soft", "$status-success-soft", "#DCFCE7"),
      swatch("Progress", "$status-progress", "#00796B"),
      swatch("Progress Soft", "$status-progress-soft", "#D9F3EE"),
      swatch("Warning", "$status-warning", "#B96100"),
      swatch("Error", "$status-error", "#BA1A1A"),
    ]),
  ]);
}

function buildType() {
  return frame("A3 · 字体", {
    x: 3040, y: 0, width: 1440, height: 920, clip: true, layout: "vertical",
    fill: "$surface-paper", padding: 48, gap: 8,
  }, [
    colOf("Intro", 8, [
      eyebrow("TYPOGRAPHY"),
      txt("H", "字体", { size: 32, weight: 700, fill: "$forest-950", font: "$font-display" }),
      wrapText("P", "产品界面使用 Noto Sans SC（与前端 --font-display / --font-body / --font-data 一致）。设计规范中的 Plus Jakarta Sans / Inter 仅作品牌参考，不覆盖已上线中文界面。", 1000, { size: 14, fill: "$text-muted", lh: 1.6 }),
    ]),
    typeRow("Display  32 / 700", "今天想拆解哪条爆款？", 32, 700, 1.25, -0.6),
    typeRow("Headline  24 / 700", "选择一种观察方式", 24, 700, 1.33, -0.24),
    typeRow("Module  18 / 700", "宏泰AI智能体", 18, 700, 1.44),
    typeRow("Section  16 / 700", "最近拆解", 16, 700, 1.5),
    typeRow("Body  16 / 400", "让 AI 助你洞察爆款逻辑。结果只提供日常参考，不替代专业意见。", 16, 400, 1.625),
    typeRow("Label  14 / 600", "作品链接", 14, 600, 1.43),
    typeRow("Caption  13 / 400", "支持抖音、小红书、B站；快手仅支持公开单条链接。", 13, 400, 1.54),
    typeRow("Meta  12 / 700", "LOCAL OBSERVATION", 12, 700, 1.5, 1.56),
  ]);
}

function buildSpace() {
  return frame("A4 · 间距圆角阴影", {
    x: 4560, y: 0, width: 1440, height: 720, clip: true, layout: "vertical",
    fill: "$surface-paper", padding: 48, gap: 24,
  }, [
    colOf("Intro", 8, [
      eyebrow("LAYOUT"),
      txt("H", "间距 · 圆角 · 阴影", { size: 32, weight: 700, fill: "$forest-950", font: "$font-display" }),
      wrapText("P", "8px 节奏。手机页边距 16px，卡片 16px，控件 12px，主按钮与状态胶囊用 pill。阴影带深绿色相，避免脏灰。", 1000, { size: 14, fill: "$text-muted", lh: 1.6 }),
    ]),
    rowOf("Two cols", 64, [
      colOf("Spacing", 10, [
        txt("SH", "Spacing", { size: 16, weight: 700, fill: "$action-primary" }),
        spaceDemo("space-1", 4),
        spaceDemo("space-2", 8),
        spaceDemo("space-3", 12),
        spaceDemo("space-4", 16),
        spaceDemo("space-5", 20),
        spaceDemo("space-6", 24),
        spaceDemo("space-8", 32),
        spaceDemo("space-10", 40),
      ], { width: 420 }),
      colOf("Radius", 16, [
        txt("RH", "Radius", { size: 16, weight: 700, fill: "$action-primary" }),
        rowOf("Rs", 16, [
          radiusDemo("sm 4", 4),
          radiusDemo("control 12", 12),
          radiusDemo("card 16", 16),
          radiusDemo("large 24", 24),
          radiusDemo("pill", 999),
        ]),
        txt("EH", "Elevation", { size: 16, weight: 700, fill: "$action-primary" }),
        rowOf("Es", 20, [
          frame("Card Shadow", { width: 160, height: 72, fill: "$surface-card", cornerRadius: 16, stroke: "#BFC9C46B", strokeWidth: 1, effect: cardShadow(), layout: "horizontal", alignItems: "center", justifyContent: "center" }, [txt("cs", "card", { size: 13, fill: "$text-muted" })]),
          frame("Float Shadow", { width: 160, height: 72, fill: "$action-primary", cornerRadius: 16, effect: floatShadow(), layout: "horizontal", alignItems: "center", justifyContent: "center" }, [txt("fs", "floating CTA", { size: 13, fill: "#FFFFFF" })]),
          frame("Glass", { width: 160, height: 72, fill: "$glass-fill", cornerRadius: 16, stroke: "#BFC9C44D", strokeWidth: 1, effect: glassBlur(), layout: "horizontal", alignItems: "center", justifyContent: "center" }, [txt("gs", "glass 20px", { size: 13, fill: "$action-primary" })]),
        ]),
      ]),
    ]),
  ]);
}

function buildIcons() {
  const names = Object.keys(ICONS);
  const rows = [];
  for (let i = 0; i < names.length; i += 12) {
    rows.push(rowOf(`Icon Row ${i / 12 + 1}`, 12, names.slice(i, i + 12).map(iconTile)));
  }
  return frame("A5 · 图标", {
    x: 6080, y: 0, width: 1440, height: 1080, clip: true, layout: "vertical",
    fill: "$surface-paper", padding: 48, gap: 16,
  }, [
    colOf("Intro", 8, [
      eyebrow("ICONS"),
      txt("H", "图标", { size: 32, weight: 700, fill: "$forest-950", font: "$font-display" }),
      wrapText("P", "与 apps/web/src/components/Icon.tsx 同一套 24×24 路径，描边 1.8、圆角端点。底栏五项：health_cross / analytics / movie_edit / content_paste / settings。", 1100, { size: 14, fill: "$text-muted", lh: 1.6 }),
    ]),
    ...rows,
  ]);
}

function ruleCard(num, title, body) {
  return glassCard(`Rule ${num}`, [
    txt("n", num, { size: 12, weight: 700, fill: "$accent", font: "$font-data", ls: 1 }),
    wrapText("t", title, "fill_container", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
    wrapText("p", body, "fill_container", { size: 13, fill: "$text-subtle", lh: 1.5 }),
  ], { padding: 16 });
}

function buildRules() {
  return frame("A6 · 交互规则", {
    x: 7600, y: 0, width: 1440, height: 980, clip: true, layout: "vertical",
    fill: "$surface-paper", padding: 48, gap: 20,
  }, [
    colOf("Intro", 8, [
      eyebrow("INFORMATION ARCHITECTURE"),
      txt("H", "交互规则", { size: 32, weight: 700, fill: "$forest-950", font: "$font-display" }),
      wrapText("P", "来自 docs/交互信息架构规范.md。设计稿里的屏幕必须遵守这些规则，不能为了“好看”加假控件或第二颗主按钮。", 1100, { size: 14, fill: "$text-muted", lh: 1.6 }),
    ]),
    frame("Rules", { layout: "horizontal", width: "fill_container", gap: 16, alignItems: "start" }, [
      ruleCard("01", "一层只做一件事", "底栏换对象，路由进具体对象，Tab 换同一对象的视角，弹层不改变当前对象。"),
      ruleCard("02", "一屏一颗主按钮", "主按钮固定在底栏之上的 contextual-action。文案随阶段变。删除永远不是主按钮。"),
      ruleCard("03", "不让用户找下一步", "状态就地更新。流程走完，下一步已经出现在底部操作条。"),
      ruleCard("04", "不渲染假控件", "点了没反应的铃铛、未接入的发布入口、闲置 Tab 一律不画。"),
    ]),
    glassCard("Nav Map", [
      wrapText("t", "底栏五项与滑动顺序", "fill_container", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
      wrapText("p", "AI /observation/new → 拆解 / → 制作 /create → 模板 /templates → 设置 /settings。制作子路由：/create/:projectId/edit 微调导出，/replica/:taskId 按清单复刻。富迪素材库是制作页右上角弹层，不占底栏。发布无入口。", "fill_container", { size: 14, fill: "$text-subtle", lh: 1.55 }),
    ]),
  ]);
}

function buildComponents() {
  C.btnPrimary = id();
  D.btnPrimaryLabel = id();
  const primary = frame("Button / Primary", {
    id: C.btnPrimary,
    reusable: true,
    layout: "horizontal",
    height: 56,
    padding: [12, 24],
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    fill: "$action-primary",
    cornerRadius: 999,
    effect: floatShadow(),
  }, [
    icon("bolt", 19, "$text-on-primary"),
    Object.assign(txt("Label", "开始拆解", { size: 18, weight: 600, fill: "$text-on-primary", font: "$font-display" }), { id: D.btnPrimaryLabel }),
  ]);

  C.btnSecondary = id();
  D.btnSecondaryLabel = id();
  const secondary = frame("Button / Secondary", {
    id: C.btnSecondary,
    reusable: true,
    layout: "horizontal",
    height: 48,
    padding: [12, 20],
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    fill: "$accent-soft",
    cornerRadius: 999,
  }, [
    icon("bookmark", 17, "$action-primary"),
    Object.assign(txt("Label", "存为模板", { size: 16, weight: 600, fill: "$action-primary", font: "$font-display" }), { id: D.btnSecondaryLabel }),
  ]);

  C.btnGhost = id();
  D.btnGhostLabel = id();
  const ghost = frame("Button / Ghost", {
    id: C.btnGhost,
    reusable: true,
    layout: "horizontal",
    height: 48,
    padding: [12, 20],
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    fill: "#00000000",
    stroke: "$action-primary",
    strokeWidth: 1,
    cornerRadius: 999,
  }, [
    Object.assign(txt("Label", "次要动作", { size: 16, weight: 600, fill: "$action-primary", font: "$font-display" }), { id: D.btnGhostLabel }),
  ]);

  C.btnQuiet = id();
  D.btnQuietLabel = id();
  const quiet = frame("Button / Quiet", {
    id: C.btnQuiet,
    reusable: true,
    layout: "horizontal",
    height: 48,
    padding: [12, 20],
    alignItems: "center",
    justifyContent: "center",
    fill: "$surface-container",
    cornerRadius: 999,
  }, [
    Object.assign(txt("Label", "取消", { size: 16, weight: 600, fill: "$text-subtle", font: "$font-display" }), { id: D.btnQuietLabel }),
  ]);

  C.iconBtn = id();
  const iconBtn = frame("Icon Button", {
    id: C.iconBtn,
    reusable: true,
    width: 40,
    height: 40,
    layout: "horizontal",
    alignItems: "center",
    justifyContent: "center",
    cornerRadius: 999,
  }, [icon("arrow_back", 25, "$action-primary")]);

  const gallery = frame("B · 组件", {
    x: 0, y: 1100, width: 1440, height: 1480, clip: true, layout: "vertical",
    fill: "$surface-canvas", padding: 48, gap: 28,
  }, [
    colOf("Intro", 8, [
      eyebrow("COMPONENTS"),
      txt("H", "基础组件", { size: 32, weight: 700, fill: "$forest-950", font: "$font-display" }),
      wrapText("P", "主按钮永远只有一个，固定在底栏之上。状态徽章用「图标 + 文字 + 颜色」。卡片白底、1px 描边、深绿轻阴影。", 1000, { size: 14, fill: "$text-muted", lh: 1.6 }),
    ]),
    wrapText("B1", "按钮", 200, { size: 14, weight: 700, fill: "$action-primary" }),
    rowOf("Buttons", 16, [
      button({ name: "Primary Demo", label: "开始拆解", variant: "primary", iconName: "bolt", size: "lg" }),
      button({ name: "Secondary Demo", label: "存为模板", variant: "secondary", iconName: "bookmark" }),
      button({ name: "Ghost Demo", label: "描边按钮", variant: "ghost" }),
      button({ name: "Quiet Demo", label: "取消", variant: "quiet" }),
      button({ name: "Busy Demo", label: "正在创建本地任务", variant: "busy", iconName: "sync", size: "lg" }),
      button({ name: "Warm Secondary Demo", label: "拍摄图片", variant: "secondary-warm", iconName: "camera" }),
    ]),
    wrapText("B2", "输入 / Tab / 徽章", 400, { size: 14, weight: 700, fill: "$action-primary" }),
    rowOf("Inputs", 24, [
      colOf("Input Col", 12, [
        fieldLabel("link", "作品链接"),
        Object.assign(inputField("可直接粘贴平台分享文字…", "https://v.douyin.com/xxxx"), { width: 360 }),
      ]),
      Object.assign(tabs(["粘贴链接", "上传视频"], "粘贴链接"), { width: 280 }),
      colOf("Badges", 8, [badge("completed"), badge("processing"), badge("pending"), badge("failed")]),
    ]),
    wrapText("B2b", "页头 / 底栏", 400, { size: 14, weight: 700, fill: "$action-primary" }),
    colOf("Chrome", 12, [
      Object.assign(headerBrand("宏泰AI智能体"), { width: 390 }),
      Object.assign(headerDetail("拆解详情"), { width: 390 }),
      Object.assign(headerIcon("movie_edit", "制作", materialChip()), { width: 390 }),
      Object.assign(bottomNav("home"), { width: 390 }),
    ]),
    wrapText("B3", "列表行 / 空态 / 通知", 400, { size: 14, weight: 700, fill: "$action-primary" }),
    rowOf("Lists", 24, [
      Object.assign(taskRow("v.douyin.com/职场穿搭爆款", "抖音 · 昨天 21:18", "completed"), { width: 360 }),
      Object.assign(emptyState("history", "还没有本地任务", "完成一次真实采集后，任务会保存在本机并显示在这里。"), { width: 280, fill: "$surface-card", cornerRadius: 16, stroke: "$outline-soft", strokeWidth: 1 }),
      frame("Top Notification", {
        width: 360, layout: "horizontal", padding: 12, gap: 12, alignItems: "center",
        fill: "#FFFFFDF7", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 19,
        effect: { type: "shadow", shadowType: "outer", offset: { x: 0, y: 14 }, blur: 42, color: "#1B3B322E" },
      }, [
        frame("N Icon", { width: 38, height: 38, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "$status-success-soft", cornerRadius: 13 }, [icon("check_circle", 20, "$status-success")]),
        colOf("N Copy", 3, [
          wrapText("N Title", "拆解已保存到本机", 180, { size: 13, weight: 600, fill: "$text-primary", lh: 1.35 }),
          wrapText("N Body", "可以继续制作视频，或返回任务列表。", 180, { size: 12, fill: "$text-muted", lh: 1.35 }),
        ], { width: "fill_container" }),
        frame("N Action", { padding: [7, 11], fill: "$accent-soft", cornerRadius: 999 }, [txt("N A", "查看", { size: 12, weight: 700, fill: "$action-primary" })]),
      ]),
    ]),
  ]);

  C.input = id();
  const inputComp = Object.assign(inputField("可直接粘贴平台分享文字，应用会从中提取第一个受支持链接", ""), {
    id: C.input,
    reusable: true,
    name: "Input / Share Link",
    width: 360,
  });

  C.tabs = id();
  const tabsComp = Object.assign(tabs(["粘贴链接", "上传视频"], "粘贴链接"), {
    id: C.tabs,
    reusable: true,
    name: "Tabs / Underline",
    width: 280,
  });

  C.badge = id();
  const badgeComp = Object.assign(badge("completed"), {
    id: C.badge,
    reusable: true,
  });

  C.taskRow = id();
  const taskRowComp = Object.assign(taskRow("v.douyin.com/职场穿搭爆款逻辑", "抖音 · 昨天 21:18", "completed"), {
    id: C.taskRow,
    reusable: true,
    name: "Task History Row",
    width: 360,
  });

  C.bottomNav = id();
  const navComp = Object.assign(bottomNav("home"), {
    id: C.bottomNav,
    reusable: true,
  });

  C.headerBrand = id();
  const headerComp = Object.assign(headerBrand("宏泰AI智能体"), {
    id: C.headerBrand,
    reusable: true,
  });

  const symbols = frame("B · 组件符号", {
    x: 1520, y: 1100, width: 900, height: 640, clip: true, layout: "vertical",
    fill: "$surface-paper", padding: 32, gap: 20,
  }, [
    colOf("Intro", 6, [
      eyebrow("SYMBOLS"),
      txt("H", "可复用组件", { size: 22, weight: 700, fill: "$forest-950", font: "$font-display" }),
    ]),
    rowOf("Buttons", 12, [primary, secondary, ghost, quiet, iconBtn]),
    colOf("Fields", 12, [inputComp, tabsComp, badgeComp, taskRowComp], { width: 360 }),
    colOf("Chrome", 12, [headerComp, navComp], { width: 390 }),
  ]);

  return [gallery, symbols];
}

function materialChip() {
  return frame("素材库入口", {
    layout: "horizontal",
    height: 40,
    padding: [6, 12],
    gap: 4,
    alignItems: "center",
    fill: "$status-error-soft",
    cornerRadius: 999,
  }, [
    icon("video_library", 18, "$status-error"),
    txt("Gift", "素材库", { size: 13, weight: 600, fill: "$status-error" }),
  ]);
}

function inspectCard() {
  return frame("Link Preview", {
    layout: "horizontal",
    width: "fill_container",
    padding: 12,
    gap: 12,
    fill: "$accent-soft",
    cornerRadius: 12,
  }, [
    icon("check_circle", 18, "$action-primary"),
    colOf("Inspect Body", 2, [
      wrapText("Inspect Title", "已识别 抖音", 260, { size: 13, weight: 600, fill: "$action-primary" }),
      wrapText("Inspect Url", "v.douyin.com/xxxx", 260, { size: 12, fill: "$text-muted" }),
    ], { width: "fill_container" }),
  ]);
}

function hint(text) {
  return frame("Hint", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "start" }, [
    icon("info", 16, "$text-muted"),
    wrapText("Hint Text", text, "fill_container", { size: 12, fill: "$text-muted", lh: 1.45 }),
  ]);
}

function completedNextStepsCta() {
  return ctaBar(frame("Next Steps", { layout: "vertical", width: 358, gap: 8 }, [
    button({ name: "Save Tpl", label: "存为模板", variant: "secondary", iconName: "bookmark", width: "fill_container" }),
    button({ name: "Replica", label: "按清单复刻", variant: "secondary", iconName: "list", width: "fill_container" }),
    button({ name: "Make", label: "用它做视频", variant: "primary", iconName: "movie_edit", width: "fill_container" }),
  ]));
}

function flowSwitch(iconName, label, action = "更换") {
  return frame("Flow Switch", {
    layout: "horizontal",
    width: "fill_container",
    padding: [12, 14],
    gap: 12,
    alignItems: "center",
    fill: "$surface-card",
    stroke: "$outline-soft",
    strokeWidth: 1,
    cornerRadius: 12,
    effect: cardShadow(),
  }, [
    icon(iconName, 19, "$action-primary"),
    wrapText("Label", label, "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
    txt("Action", action, { size: 12, weight: 600, fill: "$action-primary" }),
  ]);
}

function entryCard({ iconName, title, body, caveat, notes }) {
  return glassCard(`Entry/${title}`, [
    frame("Head", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "center" }, [
      icon(iconName, 22, "$action-primary"),
      wrapText("t", title, "fill_container", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
      icon("chevron_right", 19, "$text-muted"),
    ]),
    wrapText("p", body, "fill_container", { size: 13, fill: "$text-muted", lh: 1.55 }),
    wrapText("c", caveat, "fill_container", { size: 13, fill: "$text-subtle", lh: 1.55 }),
    ...notes.map((note, index) => wrapText(`n${index}`, note, "fill_container", { size: 12, fill: "$text-muted", lh: 1.5 })),
  ], { padding: 16, gap: 12 });
}

function previewFrame(iconName, label, color = "#7EBDAC") {
  return frame("Preview Wrap", { layout: "horizontal", width: "fill_container", justifyContent: "center" }, [
    frame("Preview", {
      width: 196, height: 348, layout: "vertical", gap: 8, alignItems: "center", justifyContent: "center",
      fill: "#071C18", cornerRadius: 12,
    }, [
      icon(iconName, 36, color),
      txt("ep", label, { size: 12, fill: "#BFC9C4" }),
    ]),
  ]);
}

function templateChip(name, selected) {
  return frame(`Tpl/${name}`, {
    layout: "vertical",
    width: "fill_container",
    padding: 10,
    gap: 4,
    fill: selected ? "$accent-soft" : "$surface-low",
    stroke: selected ? "$primary-soft" : "$outline-soft",
    strokeWidth: 1,
    cornerRadius: 12,
  }, [
    wrapText("n", name, "fill_container", { size: 12, weight: 700, fill: "$action-primary" }),
  ]);
}

function buildScreens() {
  const s1 = phone({
    name: "S1 拆解 · 粘贴链接",
    title: "宏泰AI智能体", active: "home",
    content: [
      colOf("Heading", 8, [
        wrapText("H2", "今天想拆解哪条爆款？", "fill_container", { size: 24, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.33, ls: -0.6 }),
        wrapText("Sub", "让 AI 助你洞察爆款逻辑", "fill_container", { size: 13, fill: "$text-muted", lh: 1.55 }),
      ]),
      glassCard("Source Card", [
        tabs(["粘贴链接", "上传视频"], "粘贴链接"),
        fieldLabel("link", "作品链接"),
        inputField("可直接粘贴平台分享文字，应用会从中提取第一个受支持链接", "https://v.douyin.com/xxxx"),
        hint("支持抖音、小红书、B站；快手仅支持公开单条链接并会标记为实验性。"),
        inspectCard(),
      ]),
      colOf("History", 12, [
        sectionHead("最近拆解"),
        taskRow("v.douyin.com/职场穿搭爆款逻辑", "抖音 · 昨天 21:18", "completed"),
        taskRow("我上传的视频", "本地上传 · 今天 09:02", "processing"),
      ]),
    ],
    cta: ctaBar(button({ name: "CTA", label: "开始拆解", variant: "primary", iconName: "bolt", size: "lg", width: 358 })),
  });

  const s2 = phone({
    name: "S2 拆解 · 上传视频",
    title: "宏泰AI智能体", active: "home",
    content: [
      colOf("Heading", 8, [
        wrapText("H2", "今天想拆解哪条爆款？", "fill_container", { size: 24, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.33, ls: -0.6 }),
        wrapText("Sub", "让 AI 助你洞察爆款逻辑", "fill_container", { size: 13, fill: "$text-muted", lh: 1.55 }),
      ]),
      glassCard("Source Card", [
        tabs(["粘贴链接", "上传视频"], "上传视频"),
        colOf("Upload Copy", 8, [
          wrapText("U Title", "上传本地视频", "fill_container", { size: 14, weight: 700, fill: "$action-primary", font: "$font-display" }),
          wrapText("U Body", "请选择一段带有清晰人声的 MP4 视频，应用会先识别口播内容，再生成拆解结果。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.55 }),
          wrapText("U Small", "单个 MP4，最大 250MB。视频只保存在本机。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.45 }),
        ]),
      ]),
      colOf("History", 12, [
        sectionHead("最近拆解"),
        emptyState("history", "还没有本地任务", "完成一次真实采集后，任务会保存在本机并显示在这里。"),
      ]),
    ],
    cta: ctaBar(button({ name: "CTA", label: "选择视频并拆解", variant: "primary", iconName: "upload_file", size: "lg", width: 358 })),
  });

  const s3 = phone({
    name: "S3 拆解详情 · 处理中",
    title: "拆解详情", mode: "detail", active: "home",
    content: [
      frame("Processing Hero", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [
        frame("Orb", { width: 48, height: 48, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "$status-progress-soft", cornerRadius: 999 }, [
          icon("sync", 31, "$status-progress"),
        ]),
        colOf("Hero Copy", 8, [
          frame("Hero Line", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "center" }, [
            wrapText("H2", "抖音采集任务", "fill_container", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.3 }),
            badge("processing"),
          ]),
          wrapText("Url", "v.douyin.com/xxxx", "fill_container", { size: 13, fill: "$text-muted" }),
        ], { width: "fill_container" }),
      ]),
      glassCard("Stage Card", [
        frame("Stage Head", { layout: "horizontal", width: "fill_container", justifyContent: "space_between", alignItems: "center" }, [
          colOf("SH", 4, [eyebrow("处理进度"), txt("H3", "正在处理内容", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
          txt("Count", "4 条进度", { size: 12, fill: "$text-muted", font: "$font-data" }),
        ]),
        progressStep("识别链接", "done", "已规范化为抖音公开作品链接"),
        progressStep("解析作品", "done", "标题、封面与时长已写入本机"),
        progressStep("语音转写", "run", "正在识别口播，可离开此页"),
        progressStep("生成拆解", "wait", "转写完成后才会开始", true),
      ]),
      wrapText("Leave", "进程在后台运行，可以放心离开此页", "fill_container", { size: 13, fill: "$text-muted", align: "center" }),
    ],
  });

  const s4 = phone({
    name: "S4 拆解完成",
    title: "拆解完成", mode: "detail", active: "home",
    content: [
      glassCard("Summary", [
        frame("Sum Head", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "start" }, [
          colOf("Sum Titles", 6, [
            eyebrow("LOCAL TASK"),
            wrapText("Title", "职场穿搭爆款逻辑拆解", "fill_container", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.3 }),
          ], { width: "fill_container" }),
          badge("completed"),
        ]),
        wrapText("Canon", "v.douyin.com/xxxx", "fill_container", { size: 13, fill: "$text-muted" }),
        frame("Facts", { layout: "horizontal", width: "fill_container", gap: 12 }, [
          frame("F1", { layout: "horizontal", gap: 4, alignItems: "center" }, [icon("language", 15, "$action-primary"), txt("t", "抖音", { size: 12, fill: "$text-subtle" })]),
          frame("F2", { layout: "horizontal", gap: 4, alignItems: "center" }, [icon("video_file", 15, "$action-primary"), txt("t", "视频", { size: 12, fill: "$text-subtle" })]),
          frame("F3", { layout: "horizontal", gap: 4, alignItems: "center" }, [icon("update", 15, "$action-primary"), txt("t", "222 秒", { size: 12, fill: "$text-subtle" })]),
        ]),
      ]),
      frame("Media", {
        width: "fill_container", height: 180, cornerRadius: 16, clip: true, layout: "none",
        fill: { type: "gradient", gradientType: "linear", rotation: 225, colors: [{ color: "#0C312D", position: 0 }, { color: "#12645B", position: 0.5 }, { color: "#A7D6C8", position: 1 }] },
      }, [
        frame("Play", { x: 143, y: 58, width: 64, height: 64, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "#004D40E0", cornerRadius: 999, effect: floatShadow() }, [
          icon("play", 28, "#FFFFFF"),
        ]),
      ]),
      colOf("Result", 12, [
        tabs(["原始文稿", "AI自动拆解"], "AI自动拆解"),
        glassCard("Hook Card", [
          frame("Hook Head", { layout: "horizontal", width: "fill_container", justifyContent: "space_between" }, [
            txt("Hook", "开场钩子", { size: 14, weight: 700, fill: "$action-primary" }),
            txt("Time", "00:00–00:15", { size: 12, fill: "$text-muted", font: "$font-data" }),
          ]),
          wrapText("Quote", "如果你还在手动整理素材，这条视频会改变你的节奏。", "fill_container", { size: 14, fill: "$text-subtle", lh: 1.55 }),
          rowOf("Tags", 8, [
            frame("Tag1", { padding: [4, 10], fill: "$accent-soft", cornerRadius: 999 }, [txt("t", "痛点共鸣", { size: 12, weight: 600, fill: "$action-primary" })]),
            frame("Tag2", { padding: [4, 10], fill: "$accent-soft", cornerRadius: 999 }, [txt("t", "利益前置", { size: 12, weight: 600, fill: "$action-primary" })]),
          ]),
        ]),
      ]),
    ],
    cta: completedNextStepsCta(),
    ctaHeight: 160,
  });

  const s5 = phone({
    name: "S5 制作 · 入口",
    title: "制作", mode: "icon", iconName: "movie_edit", active: "create",
    right: materialChip(),
    content: [
      colOf("Heading", 8, [
        wrapText("H2", "这次走哪条路？", "fill_container", { size: 24, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.3, ls: -0.4 }),
        wrapText("Sub", "先选一种做法。两条路要准备的东西不一样。", "fill_container", { size: 13, fill: "$text-muted", lh: 1.55 }),
      ]),
      entryCard({
        iconName: "movie_edit",
        title: "Agent 模式",
        body: "导入自己拍的照片或视频，选定目标时长。应用会写旁白和字幕；成片要导入素材后，在制作页再发起合成。",
        caveat: "这台安装不一定能看画面：看不到就按拆解结构写，能看到才会参考画面里看得见的内容。生成后微调页会告诉你是哪一种。两种情况都不会核对文字是否对得上每个镜头，需要你逐镜核对。",
        notes: [
          "默认这条路需要一份成功拆解，再准备至少 3 张图片或视频。配音优先用 AI 连接里的云端旁白，没配才用系统语音。",
          "数字人口播是下一步里的开关：一条已录好原声的 MP4 即可，只烧字幕、不配音，不需要 3 份素材。",
        ],
      }),
      entryCard({
        iconName: "list",
        title: "爆款复刻",
        body: "按拆解列出的分镜清单，逐项拍摄或绑定素材，再生成脚本和字幕。",
        caveat: "清单只说该拍什么，不代表画面里真的有这些内容；绑错文件也不会被拦住。",
        notes: ["需要一份成功拆解。还没有的话，先去采集并运行 AI 自动拆解。成片仍要回制作页合成。"],
      }),
    ],
  });

  const s6 = phone({
    name: "S6 制作 · Agent 新建",
    title: "制作", mode: "icon", iconName: "movie_edit", active: "create",
    right: materialChip(),
    content: [
      flowSwitch("movie_edit", "Agent 模式"),
      wrapText("H2", "这次想讲什么？", "fill_container", { size: 28, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.16 }),
      glassCard("Setup", [
        hint("这台安装不一定能看画面：看不到就按拆解结构写，能看到才会参考画面里看得见的内容。生成后微调页会告诉你是哪一种。两种情况都不会核对文字是否对得上每个镜头，需要你逐镜核对，看不清的素材要重拍。"),
        wrapText("L1", "你的经营需求", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        frame("Textarea", {
          width: "fill_container", height: 104, padding: 12, fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12,
        }, [wrapText("TA", "面向附近上班族，突出真实环境、服务过程和到店体验，不夸大承诺。", "fill_container", { size: 14, fill: "$text-subtle", lh: 1.55 })]),
        wrapText("Count", "38/500", "fill_container", { size: 13, fill: "$text-muted" }),
        wrapText("L2", "参考哪条拆解", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        rowOf("Sources", 8, [
          frame("Src On", { width: 148, padding: 12, fill: "$accent-soft", stroke: "$primary-soft", strokeWidth: 1, cornerRadius: 12 }, [wrapText("s", "抖音 · 2026/8/17", 124, { size: 12, weight: 600, fill: "$action-primary" })]),
          frame("Src Off", { width: 148, padding: 12, fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [wrapText("s", "本地上传 · 2026/8/16", 124, { size: 12, fill: "$text-subtle" })]),
        ]),
        wrapText("L3", "也可以改用数字人口播", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        frame("Avatar Option", {
          layout: "horizontal", width: "fill_container", padding: 12, gap: 8, alignItems: "center",
          fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12,
        }, [
          icon("record_voice_over", 19, "$action-primary"),
          colOf("AV", 3, [
            wrapText("t", "数字人口播", "fill_container", { size: 12, weight: 700, fill: "$action-primary" }),
            wrapText("d", "改用已录好原声的 MP4，只烧字幕、不配音", "fill_container", { size: 11, fill: "$text-muted", lh: 1.35 }),
          ], { width: "fill_container" }),
        ]),
        wrapText("L4", "主文字（可选）", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        frame("Headline", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
          wrapText("ph", "例如：你出时间，我出货", "fill_container", { size: 14, fill: "$text-muted" }),
        ]),
        wrapText("Help", "留空时由 AI 根据你的真实需求生成；填写后成片会逐字使用。", "fill_container", { size: 12, fill: "$text-muted" }),
        wrapText("L5", "文字预设", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        frame("Preset", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", justifyContent: "space_between", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
          txt("pv", "经典顶部白字", { size: 14, fill: "$text-subtle" }),
          icon("chevron_down", 16, "$text-muted"),
        ]),
        wrapText("L6", "目标时长", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        frame("Duration", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", justifyContent: "space_between", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
          txt("dv", "30 秒", { size: 14, fill: "$text-subtle" }),
          icon("chevron_down", 16, "$text-muted"),
        ]),
      ]),
    ],
    cta: ctaBar(button({ name: "CTA", label: "创建制作项目", variant: "primary", iconName: "movie_edit", size: "lg", width: 358 })),
  });

  const s7 = phone({
    name: "S7 模板",
    title: "模板", mode: "icon", iconName: "content_paste", active: "templates",
    right: frame("Header New", {
      layout: "horizontal", height: 40, padding: [8, 14], gap: 6, alignItems: "center",
      fill: "$accent-soft", cornerRadius: 999,
    }, [icon("sparkle", 17, "$action-primary"), txt("New", "新建", { size: 13, weight: 600, fill: "$action-primary" })]),
    content: [
      colOf("Hero", 8, [
        eyebrow("REUSABLE STRUCTURE"),
        wrapText("H2", "把拆解方法变成自己的内容模版", "fill_container", { size: 24, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.3, ls: -0.4 }),
        wrapText("P", "这里只保存公式、步骤与变量槽，不复制原视频、供应商响应或推理内容。保存后可独立编辑和删除。", "fill_container", { size: 14, fill: "$text-muted", lh: 1.6 }),
      ]),
      glassCard("Import", [
        frame("Title row", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [
          txt("Num", "01", { size: 18, weight: 700, fill: "$primary-soft", font: "$font-data" }),
          colOf("T", 4, [
            wrapText("t", "从拆解结果保存", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
            wrapText("s", "把内容结构保存成以后可以继续使用的模板", "fill_container", { size: 12, fill: "$text-muted" }),
          ], { width: "fill_container" }),
        ]),
        wrapText("L", "拆解来源", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        frame("Select", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", justifyContent: "space_between", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
          txt("sv", "抖音 · 8月17日", { size: 14, fill: "$text-subtle" }),
          icon("chevron_right", 16, "$text-muted"),
        ]),
        button({ name: "Save Tpl", label: "保存为模板", variant: "primary", iconName: "bookmark", width: "fill_container" }),
      ]),
      colOf("Library", 12, [
        colOf("LH", 4, [eyebrow("LOCAL TEMPLATES"), txt("H3", "我的模板", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
        glassCard("Tpl Card", [
          wrapText("n", "职场钩子三段式", "fill_container", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
          wrapText("s", "痛点开场 → 方法拆解 → 行动号召", "fill_container", { size: 13, fill: "$text-muted", lh: 1.45 }),
        ], { padding: 16 }),
      ]),
    ],
  });

  const s8 = phone({
    name: "S8 设置",
    title: "设置", active: "settings",
    content: [
      glassCard("Profile Overview", [
        frame("Overview", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "center" }, [
          frame("Avatar", {
            width: 60, height: 60, cornerRadius: 999, layout: "horizontal", alignItems: "center", justifyContent: "center",
            fill: { type: "gradient", gradientType: "linear", rotation: 215, colors: [{ color: "#BBE9E1", position: 0 }, { color: "#ECEEEC", position: 1 }] },
            stroke: "#004D4024", strokeWidth: 1,
          }, [icon("face", 28, "$action-primary")]),
          colOf("P Body", 2, [
            txt("Overline", "本地档案", { size: 10, weight: 700, fill: "$status-progress", ls: 0.8, font: "$font-data" }),
            wrapText("Name", "林晓", "fill_container", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.4 }),
            wrapText("Meta", "宏泰家居 · 全屋定制", "fill_container", { size: 12, fill: "$text-muted" }),
          ], { width: "fill_container" }),
          icon("chevron_right", 19, "$text-muted"),
        ]),
      ], { padding: [16, 20] }),
      colOf("Local", 8, [
        txt("SH", "本地资料", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
        glassCard("Local Card", [settingsRow("business_center", "档案与头像", "名称、门店、行业与经营标签")], { padding: 0, gap: 0 }),
      ]),
      colOf("AI", 8, [
        txt("SH", "AI 连接", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
        glassCard("AI Card", [settingsRow("key", "MiMo-V2-Omni", "API Key 已保存在设备安全存储", true)], { padding: 0, gap: 0 }),
      ]),
      colOf("About", 8, [
        txt("SH", "关于应用", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
        glassCard("About Card", [settingsRow("info", "应用信息", "查看当前版本号与最近更新")], { padding: 0, gap: 0 }),
      ]),
      glassCard("Security", [
        frame("Note", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [
          icon("key", 20, "$action-primary"),
          wrapText("p", "本地档案与公开 AI 配置保存在本机应用数据中；API Key 仅写入 Android Keystore，不会回传到页面。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.54 }),
        ]),
      ], { fill: "$surface-low", padding: 16 }),
    ],
  });

  const s9 = phone({
    name: "S9 AI 观察",
    title: "舌象与面部观察", active: "ai", warm: true,
    content: [
      colOf("Heading", 8, [
        eyebrow("LOCAL OBSERVATION"),
        wrapText("H2", "选择一种观察方式", "fill_container", { size: 24, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.3 }),
        wrapText("P", "每个会话只能选择舌象或面部其中一种图片。结果只提供日常参考，不替代专业意见。", "fill_container", { size: 14, fill: "$text-muted", lh: 1.6 }),
      ]),
      frame("Modes", { layout: "horizontal", width: "fill_container", gap: 12 }, [
        frame("Tongue", { layout: "vertical", width: "fill_container", padding: 16, gap: 8, fill: "$surface-card", stroke: "$accent", strokeWidth: 1.5, cornerRadius: 16, effect: cardShadow() }, [
          icon("visibility", 28, "$accent"),
          wrapText("t", "舌象观察", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
          wrapText("d", "请在自然光下拍摄舌面，并只用于本次本地观察。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.4 }),
          frame("Check", { layout: "horizontal", justifyContent: "end", width: "fill_container" }, [icon("check_circle", 18, "$accent")]),
        ]),
        frame("Face", { layout: "vertical", width: "fill_container", padding: 16, gap: 8, fill: "$surface-card", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 16, effect: cardShadow() }, [
          icon("face", 28, "$action-primary"),
          wrapText("t", "面部观察", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
          wrapText("d", "请在自然光下正面拍摄面部，并只用于本次本地观察。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.4 }),
        ]),
      ]),
      glassCard("Capture", [
        colOf("Cap Copy", 6, [
          eyebrow("STEP 2"),
          txt("H3", "舌象图片", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
          wrapText("p", "尽量保持舌面清晰、避免滤镜和强色光。", "fill_container", { size: 13, fill: "$text-muted" }),
        ]),
        frame("Empty Capture", {
          width: "fill_container", height: 160, layout: "vertical", gap: 8, alignItems: "center", justifyContent: "center",
          fill: "$surface-low", cornerRadius: 12,
        }, [
          icon("camera", 30, "$text-muted"),
          txt("e", "尚未选择图片", { size: 13, fill: "$text-muted" }),
        ]),
        frame("Actions", { layout: "horizontal", width: "fill_container", gap: 8 }, [
          button({ name: "Shot", label: "拍摄图片", variant: "secondary-warm", iconName: "camera", width: "fill_container" }),
          button({ name: "Pick", label: "选择图片", variant: "secondary-warm", iconName: "upload_file", width: "fill_container" }),
        ]),
        button({ name: "Gen", label: "生成观察报告", variant: "primary", iconName: "auto_awesome", width: "fill_container" }),
        hint("图片只保存在本机，不会自动上传或公开发布。"),
      ]),
      colOf("History", 12, [
        colOf("HH", 4, [eyebrow("LOCAL HISTORY"), txt("H3", "本地观察历史", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
        emptyState("history", "尚无本地观察", "完成一次真实图片观察后，会话和正式报告会保存在本地这里。"),
      ]),
    ],
  });

  const s10 = phone({
    name: "S10 观察报告",
    title: "舌象观察", mode: "detail", active: "ai", warm: true,
    content: [
      frame("Hero", { layout: "vertical", width: "fill_container", gap: 8 }, [
        frame("Hero Top", { layout: "horizontal", width: "fill_container", justifyContent: "space_between", alignItems: "start", gap: 8 }, [
          colOf("HT", 6, [
            eyebrow("图片观察报告"),
            wrapText("H2", "舌面整体偏红，中后部有薄白苔", "fill_container", { size: 20, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.35 }),
            wrapText("P", "单张图片观察 · 本地保存 · 日常参考", "fill_container", { size: 13, fill: "$text-muted" }),
          ], { width: "fill_container" }),
          frame("Status", { layout: "horizontal", padding: [4, 10], gap: 4, alignItems: "center", fill: "$status-success-soft", cornerRadius: 999 }, [
            icon("check_circle", 16, "$status-success"),
            txt("st", "已保存观察报告", { size: 12, weight: 600, fill: "$status-success" }),
          ]),
        ]),
      ]),
      glassCard("Source", [
        frame("Img", { width: "fill_container", height: 160, fill: { type: "gradient", gradientType: "radial", colors: [{ color: "#F8E8E4", position: 0 }, { color: "#C9897A", position: 1 }] }, cornerRadius: 12 }),
        colOf("Src Copy", 4, [
          eyebrow("本次观察图片"),
          txt("t", "舌象图片", { size: 14, weight: 700, fill: "$action-primary" }),
          wrapText("p", "图片只保存在本机，仅用于生成本次报告和回答后续问题。", "fill_container", { size: 13, fill: "$text-muted", lh: 1.45 }),
        ]),
      ]),
      glassCard("Quality", [
        frame("Q", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [
          icon("check_circle", 23, "$status-success"),
          colOf("QB", 4, [
            wrapText("t", "图像可用，细节足够", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
            wrapText("p", "舌面主体清晰，边缘轻微反光，不影响主要观察。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
          ], { width: "fill_container" }),
        ]),
      ], { fill: "$status-success-soft" }),
      colOf("Points", 12, [
        colOf("PH", 4, [eyebrow("SUMMARY"), txt("H3", "可见要点", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
        glassCard("P1", [frame("r", { layout: "horizontal", gap: 8, alignItems: "start" }, [icon("visibility", 18, "$action-primary"), wrapText("t", "舌色偏红，中后部苔薄白", "fill_container", { size: 13, fill: "$text-subtle" })])], { fill: "$surface-low", padding: 12 }),
        glassCard("P2", [frame("r", { layout: "horizontal", gap: 8, alignItems: "start" }, [icon("visibility", 18, "$action-primary"), wrapText("t", "边缘完整，未见明显齿痕", "fill_container", { size: 13, fill: "$text-subtle" })])], { fill: "$surface-low", padding: 12 }),
      ]),
      colOf("Obs", 12, [
        frame("OH", { layout: "horizontal", width: "fill_container", justifyContent: "space_between" }, [
          colOf("OHt", 4, [eyebrow("OBSERVATIONS"), txt("H3", "图片可见观察", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
          txt("c", "4 项", { size: 12, fill: "$text-muted", font: "$font-data" }),
        ]),
        glassCard("O1", [
          frame("OT", { layout: "horizontal", width: "fill_container", justifyContent: "space_between" }, [
            colOf("ott", 2, [txt("r", "舌面", { size: 12, fill: "$text-muted" }), txt("l", "颜色", { size: 14, weight: 700, fill: "$action-primary" })]),
            txt("v", "清晰可见", { size: 12, fill: "$status-progress" }),
          ]),
          wrapText("d", "中后部颜色较四周略深，整体仍在自然红范围内。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
          wrapText("e", "依据：舌面中后部与两侧色差可见，没有被强反光完全遮挡。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.4 }),
        ], { padding: 16 }),
      ]),
      colOf("Ref", 12, [
        colOf("RH", 4, [eyebrow("DAILY REFERENCE"), txt("H3", "日常参考", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
        glassCard("R1", [
          frame("rr", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [
            icon("lightbulb", 20, "$accent"),
            colOf("rb", 4, [
              wrapText("t", "记录相近光线下的舌面变化", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
              wrapText("p", "若做日常记录，尽量在同一时段、自然光下拍摄，便于前后对照。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
              txt("c", "可能的日常参考", { size: 12, fill: "$text-muted" }),
            ], { width: "fill_container" }),
          ]),
        ], { padding: 16 }),
      ]),
      colOf("Sug", 12, [
        colOf("SH", 4, [eyebrow("SUGGESTIONS"), txt("H3", "日常建议", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
        glassCard("S1", [
          frame("st", { layout: "horizontal", width: "fill_container", justifyContent: "space_between" }, [
            wrapText("t", "保持规律饮水与作息观察", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
            frame("pr", { padding: [2, 8], fill: "$status-progress-soft", cornerRadius: 999 }, [txt("p", "可考虑", { size: 11, weight: 600, fill: "$status-progress" })]),
          ]),
          wrapText("a", "连续几天在相近光线下拍照记录，而不是单次照片下结论。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
        ], { padding: 16 }),
      ]),
      colOf("Ask", 12, [
        colOf("AH", 4, [eyebrow("FOLLOW-UP"), txt("H3", "继续追问", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
        rowOf("Chips", 8, [
          frame("c1", { padding: [8, 12], fill: "$surface-vitality-low", cornerRadius: 999 }, [txt("t", "怎样在相近光线下做日常记录？", { size: 12, fill: "$action-primary" })]),
        ]),
        frame("Composer", { layout: "vertical", width: "fill_container", gap: 8, padding: 12, fill: "$surface-card", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 16 }, [
          wrapText("l", "输入想继续了解的问题", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          frame("TA", { width: "fill_container", height: 72, padding: 12, fill: "$surface-low", cornerRadius: 12 }, [
            wrapText("ph", "例如：怎样在相近光线下做日常记录？", "fill_container", { size: 14, fill: "$text-muted" }),
          ]),
          button({ name: "Ask", label: "发送追问", variant: "primary", iconName: "forum", width: "fill_container" }),
        ]),
      ]),
      glassCard("Safety", [
        frame("S", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [
          icon("info", 22, "$status-progress"),
          colOf("SB", 4, [
            wrapText("t", "日常参考，不构成诊断", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
            wrapText("p", "如有不适请咨询专业人士。本报告不输出疾病名称、处方或概率。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
          ], { width: "fill_container" }),
        ]),
      ]),
    ],
  });

  const s11 = phone({
    name: "S11 本地档案",
    title: "本地档案", mode: "detail", active: "settings",
    content: [
      glassCard("Avatar Editor", [
        frame("AE", { layout: "vertical", width: "fill_container", gap: 12, alignItems: "center" }, [
          frame("Avatar", {
            width: 76, height: 76, cornerRadius: 999, layout: "horizontal", alignItems: "center", justifyContent: "center",
            fill: { type: "gradient", gradientType: "linear", rotation: 215, colors: [{ color: "#BBE9E1", position: 0 }, { color: "#ECEEEC", position: 1 }] },
          }, [icon("face", 34, "$action-primary")]),
          colOf("AC", 4, [
            wrapText("o", "头像仅保存在应用私有目录", 280, { size: 10, weight: 700, fill: "$status-progress", align: "center", font: "$font-data" }),
            wrapText("s", "尚未设置头像", 280, { size: 14, weight: 700, fill: "$action-primary", align: "center" }),
            wrapText("d", "通过系统照片选择器导入，页面不直接读取外部文件路径。", 280, { size: 12, fill: "$text-muted", align: "center", lh: 1.45 }),
          ]),
          button({ name: "Pick", label: "选择头像", variant: "secondary", iconName: "camera", width: 200 }),
        ]),
      ]),
      glassCard("Form", [
        colOf("F1", 6, [
          wrapText("l", "显示名  必填", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          frame("I", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
            txt("v", "林晓", { size: 14, fill: "$text-subtle" }),
          ]),
        ]),
        colOf("F2", 6, [
          wrapText("l", "门店名", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          frame("I", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
            txt("v", "宏泰家居", { size: 14, fill: "$text-subtle" }),
          ]),
        ]),
        colOf("F3", 6, [
          wrapText("l", "行业", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          frame("I", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
            txt("v", "全屋定制", { size: 14, fill: "$text-subtle" }),
          ]),
        ]),
        colOf("F4", 6, [
          wrapText("l", "经营标签", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          frame("I", { width: "fill_container", height: 72, padding: 12, fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
            wrapText("v", "全屋定制，量尺，社区店", "fill_container", { size: 14, fill: "$text-subtle" }),
          ]),
          wrapText("h", "使用逗号或换行分隔；空标签不会保存。", "fill_container", { size: 12, fill: "$text-muted" }),
        ]),
      ]),
      button({ name: "Save", label: "保存本地档案", variant: "primary", iconName: "check_circle", size: "lg", width: "fill_container" }),
      button({ name: "Back", label: "返回设置", variant: "quiet", width: "fill_container" }),
    ],
  });

  const s12 = phone({
    name: "S12 AI 连接",
    title: "AI 连接", mode: "detail", active: "settings",
    content: [
      glassCard("Security", [
        frame("N", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [
          icon("key", 20, "$action-primary"),
          wrapText("p", "API Key 已写入设备安全存储。更换供应商或 Key 后，一键保存即可覆盖。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.54 }),
        ]),
      ], { fill: "$surface-low", padding: 16 }),
      glassCard("Preset", [
        colOf("Head", 6, [
          txt("o", "一键配置", { size: 10, weight: 700, fill: "$status-progress", font: "$font-data", ls: 0.8 }),
          wrapText("h", "选择供应商，只填 API Key", "fill_container", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.4 }),
          wrapText("p", "系统会自动填好服务地址和各项模型，并实际检测文字、图片、语音识别与视频配音是否可用。", "fill_container", { size: 13, fill: "$text-muted", lh: 1.5 }),
        ]),
        colOf("Prov", 6, [
          wrapText("l", "供应商  必填", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          frame("I", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", justifyContent: "space_between", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
            txt("v", "小米 MiMo", { size: 14, fill: "$text-subtle" }),
            icon("chevron_right", 16, "$text-muted"),
          ]),
        ]),
        frame("Models", { layout: "horizontal", width: "fill_container", gap: 8 }, [
          frame("m1", { layout: "vertical", width: "fill_container", padding: 8, gap: 2, fill: "$surface-paper", cornerRadius: 10 }, [txt("s", "文本", { size: 11, fill: "$text-muted" }), wrapText("v", "MiMo-V2-Omni", "fill_container", { size: 11, weight: 700, fill: "$action-primary" })]),
          frame("m2", { layout: "vertical", width: "fill_container", padding: 8, gap: 2, fill: "$surface-paper", cornerRadius: 10 }, [txt("s", "视觉", { size: 11, fill: "$text-muted" }), wrapText("v", "MiMo-V2-Omni", "fill_container", { size: 11, weight: 700, fill: "$action-primary" })]),
        ]),
        colOf("Key", 6, [
          wrapText("l", "API Key  仅写入，不会回显", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          frame("I", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
            txt("v", "••••••••••••", { size: 14, fill: "$text-muted" }),
          ]),
        ]),
        hint("视频渲染会直接使用这里配置的云端 TTS；旧的未配音模型连接才回退到 Android 系统语音。"),
        button({ name: "Save", label: "一键保存并检测", variant: "primary", iconName: "check_circle", size: "lg", width: "fill_container" }),
      ], { fill: { type: "gradient", gradientType: "linear", rotation: 220, colors: [{ color: "#DCF5ED", position: 0 }, { color: "#FFFFFFF0", position: 1 }] }, rest: { stroke: "#26A69A61" } }),
      colOf("Probes", 12, [
        colOf("PH", 4, [
          txt("o", "连接检测", { size: 10, weight: 700, fill: "$status-progress", font: "$font-data", ls: 0.8 }),
          wrapText("h", "文字、图片、语音识别与视频配音", "fill_container", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.4 }),
        ]),
        glassCard("P1", [frame("r", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "center" }, [
          frame("st", { width: 32, height: 32, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "$status-success-soft", cornerRadius: 999 }, [icon("check_circle", 19, "$status-success")]),
          colOf("b", 2, [txt("t", "文本", { size: 14, weight: 700, fill: "$text-subtle" }), txt("s", "MiMo-V2-Omni", { size: 12, fill: "$text-muted" })], { width: "fill_container" }),
          button({ name: "Test", label: "测试", variant: "secondary" }),
        ])], { padding: 12 }),
        glassCard("P2", [frame("r", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "center" }, [
          frame("st", { width: 32, height: 32, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "$status-success-soft", cornerRadius: 999 }, [icon("check_circle", 19, "$status-success")]),
          colOf("b", 2, [txt("t", "视觉", { size: 14, weight: 700, fill: "$text-subtle" }), txt("s", "MiMo-V2-Omni", { size: 12, fill: "$text-muted" })], { width: "fill_container" }),
          button({ name: "Test", label: "测试", variant: "secondary" }),
        ])], { padding: 12 }),
      ]),
    ],
  });

  const s13 = phone({
    name: "S13 应用信息",
    title: "应用信息", mode: "detail", active: "settings",
    content: [
      glassCard("Version", [
        frame("V", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [
          frame("Ic", { width: 45, height: 45, layout: "horizontal", alignItems: "center", justifyContent: "center", fill: "$accent-soft", cornerRadius: 14 }, [icon("info", 25, "$action-primary")]),
          colOf("VB", 4, [
            txt("o", "HongTai AI Agent", { size: 10, weight: 700, fill: "$status-progress", font: "$font-data", ls: 0.8 }),
            txt("h", "版本 0.1.18", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display" }),
            txt("p", "本机构建号 26", { size: 13, fill: "$text-muted" }),
          ]),
        ]),
      ]),
      colOf("Updates", 12, [
        frame("UH", { layout: "horizontal", width: "fill_container", justifyContent: "space_between", alignItems: "center" }, [
          colOf("UHt", 4, [eyebrow("LATEST UPDATE"), txt("H2", "最近更新", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
          txt("v", "v0.1.18", { size: 12, fill: "$text-muted", font: "$font-data" }),
        ]),
        glassCard("U1", [frame("r", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [txt("n", "01", { size: 12, weight: 700, fill: "$action-primary", font: "$font-data" }), wrapText("p", "冷启动先显示项目图标和浅色开屏，大约两三秒后再进入内容。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.5 })])], { padding: 12 }),
        glassCard("U2", [frame("r", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [txt("n", "02", { size: 12, weight: 700, fill: "$action-primary", font: "$font-data" }), wrapText("p", "制作完成后，即使页面通知出错，也不会把已经成功的成片改成失败。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.5 })])], { padding: 12 }),
        glassCard("U3", [frame("r", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [txt("n", "03", { size: 12, weight: 700, fill: "$action-primary", font: "$font-data" }), wrapText("p", "深度思考和第一块正式内容之间留出缝隙，不再贴在一起。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.5 })])], { padding: 12 }),
        glassCard("U4", [frame("r", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [txt("n", "04", { size: 12, weight: 700, fill: "$action-primary", font: "$font-data" }), wrapText("p", "键盘弹出时输入框会跟着抬高；底栏不再贴到系统手势条上。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.5 })])], { padding: 12 }),
        glassCard("U5", [frame("r", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [txt("n", "05", { size: 12, weight: 700, fill: "$action-primary", font: "$font-data" }), wrapText("p", "打开应用更轻：非首页按需载入，中文字体也收成界面用字。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.5 })])], { padding: 12 }),
        glassCard("U6", [frame("r", { layout: "horizontal", width: "fill_container", gap: 12, alignItems: "start" }, [txt("n", "06", { size: 12, weight: 700, fill: "$action-primary", font: "$font-data" }), wrapText("p", "每个安装版本都会单独保留，更新时不会覆盖以前的安装包。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.5 })])], { padding: 12 }),
      ]),
    ],
  });

  const s14 = phone({
    name: "S14 拆解完成 · 原始文稿",
    title: "拆解完成", mode: "detail", active: "home",
    content: [
      glassCard("Summary", [
        frame("Sum Head", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "start" }, [
          colOf("Sum Titles", 6, [
            eyebrow("LOCAL TASK"),
            wrapText("Title", "职场穿搭爆款逻辑拆解", "fill_container", { size: 18, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.3 }),
          ], { width: "fill_container" }),
          badge("completed"),
        ]),
        wrapText("Canon", "v.douyin.com/xxxx", "fill_container", { size: 13, fill: "$text-muted" }),
      ]),
      tabs(["原始文稿", "AI自动拆解"], "原始文稿"),
      glassCard("Transcript", [
        wrapText("t", "00:00  如果你还在手动整理素材，这条视频会改变你的节奏。", "fill_container", { size: 14, fill: "$text-subtle", lh: 1.6 }),
        wrapText("t2", "00:08  我们先看开头三秒做了什么，再拆后面的利益点。", "fill_container", { size: 14, fill: "$text-subtle", lh: 1.6 }),
        wrapText("t3", "00:16  口播只保留可追溯的真实转写，不会用平台描述伪装成语音。", "fill_container", { size: 14, fill: "$text-subtle", lh: 1.6 }),
      ]),
    ],
    cta: completedNextStepsCta(),
    ctaHeight: 160,
  });

  const s15 = phone({
    name: "S15 制作 · 爆款复刻选拆解",
    title: "制作", mode: "icon", iconName: "movie_edit", active: "create",
    right: materialChip(),
    content: [
      flowSwitch("list", "爆款复刻"),
      wrapText("H2", "按哪条拆解复刻？", "fill_container", { size: 24, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.2 }),
      glassCard("Setup", [
        wrapText("L2", "参考哪条拆解", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        rowOf("Sources", 8, [
          frame("Src On", { width: 148, padding: 12, fill: "$accent-soft", stroke: "$primary-soft", strokeWidth: 1, cornerRadius: 12 }, [wrapText("s", "抖音 · 2026/8/17", 124, { size: 12, weight: 600, fill: "$action-primary" })]),
          frame("Src Off", { width: 148, padding: 12, fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [wrapText("s", "本地上传 · 2026/8/16", 124, { size: 12, fill: "$text-subtle" })]),
        ]),
        hint("下一步会打开这条拆解的复刻向导，按清单逐项绑定素材。清单不代表画面里真的有这些内容；生成的是脚本和字幕，成片要回制作页合成。"),
      ]),
    ],
    cta: ctaBar(button({ name: "CTA", label: "按清单复刻", variant: "primary", iconName: "list", size: "lg", width: 358 })),
  });

  const s16 = phone({
    name: "S16 制作 · 缺素材",
    title: "制作", mode: "icon", iconName: "movie_edit", active: "create",
    right: materialChip(),
    content: [
      glassCard("Project", [
        previewFrame("movie_edit", "成片会显示在这里"),
        hint("本地渲染会为制作计划中的每个镜头生成 AI 连接页已配置的中文 TTS 旁白和字幕；旧连接未配置云端 TTS 时才使用 Android 系统语音。"),
        tabs(["预览", "文案", "素材"], "素材"),
        frame("Assets", { layout: "horizontal", width: "fill_container", gap: 8 }, [
          frame("A1", { width: "fill_container", height: 92, layout: "vertical", gap: 4, padding: 8, alignItems: "center", fill: "$surface-low", cornerRadius: 12 }, [
            icon("movie", 25, "$action-primary"),
            wrapText("n", "门店实拍 01", 90, { size: 11, fill: "$text-subtle", align: "center" }),
          ]),
          frame("A2", { width: "fill_container", height: 92, layout: "vertical", gap: 4, padding: 8, alignItems: "center", fill: "$surface-low", cornerRadius: 12 }, [
            icon("movie", 25, "$action-primary"),
            wrapText("n", "产品特写", 90, { size: 11, fill: "$text-subtle", align: "center" }),
          ]),
          frame("Add", { width: "fill_container", height: 92, layout: "vertical", gap: 4, padding: 8, alignItems: "center", justifyContent: "center", fill: "$surface-card", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
            icon("upload_file", 24, "$action-primary"),
            txt("a", "上传素材", { size: 11, fill: "$text-subtle" }),
            txt("c", "2/12", { size: 10, fill: "$text-muted", font: "$font-data" }),
          ]),
        ]),
        hint("至少还要 1 个图片或视频素材，才能生成制作计划。"),
        button({ name: "Delete Project", label: "删除整个项目", variant: "quiet", iconName: "close", width: "fill_container" }),
      ], { padding: 16 }),
      flowSwitch("sparkle", "再做一条", "换一种做法"),
    ],
    cta: ctaBar(button({ name: "CTA", label: "添加素材", variant: "primary", iconName: "upload_file", size: "lg", width: 358 })),
  });

  const s17 = phone({
    name: "S17 制作 · 待合成",
    title: "制作", mode: "icon", iconName: "movie_edit", active: "create",
    right: materialChip(),
    content: [
      glassCard("Project", [
        previewFrame("play", "制作计划已就绪"),
        hint("本地渲染会为制作计划中的每个镜头生成 AI 连接页已配置的中文 TTS 旁白和字幕；旧连接未配置云端 TTS 时才使用 Android 系统语音。"),
        tabs(["预览", "文案", "素材"], "预览"),
        colOf("Plan", 8, [
          txt("H3", "制作计划", { size: 14, weight: 700, fill: "$action-primary" }),
          frame("Shot1", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "start" }, [
            txt("n", "01", { size: 12, weight: 700, fill: "$primary-soft", font: "$font-data" }),
            colOf("b", 2, [
              wrapText("c", "门口实拍", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
              wrapText("n", "先说附近上班族最常犹豫的那件事。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.4 }),
            ], { width: "fill_container" }),
            txt("d", "10.0 秒", { size: 11, fill: "$text-muted", font: "$font-data" }),
          ]),
        ]),
        button({ name: "Edit Plan", label: "微调字幕与镜头", variant: "secondary", iconName: "tune", width: "fill_container" }),
        button({ name: "Regen", label: "重新生成计划", variant: "quiet", iconName: "auto_awesome", width: "fill_container" }),
        button({ name: "Delete Project", label: "删除整个项目", variant: "quiet", iconName: "close", width: "fill_container" }),
      ], { padding: 16 }),
      flowSwitch("sparkle", "再做一条", "换一种做法"),
    ],
    cta: ctaBar(button({ name: "CTA", label: "开始本地合成", variant: "primary", iconName: "bolt", size: "lg", width: 358 })),
  });

  const s18 = phone({
    name: "S18 制作 · 成片完成",
    title: "制作", mode: "icon", iconName: "movie_edit", active: "create",
    right: materialChip(),
    content: [
      glassCard("Project", [
        previewFrame("sparkle", "成片已保存在本机", "#BBE9E1"),
        tabs(["预览", "文案", "素材"], "预览"),
        hint("完成后不会出现未接入的发布入口。成片只保存在本机私有目录。"),
        button({ name: "Edit Plan", label: "微调字幕与镜头", variant: "secondary", iconName: "tune", width: "fill_container" }),
        button({ name: "Delete Output", label: "删除成片", variant: "quiet", iconName: "close", width: "fill_container" }),
        button({ name: "Delete Project", label: "删除整个项目", variant: "quiet", iconName: "close", width: "fill_container" }),
      ], { padding: 16 }),
    ],
    cta: ctaBar(button({ name: "CTA", label: "再做一条", variant: "primary", iconName: "sparkle", size: "lg", width: 358 })),
  });

  const s19 = phone({
    name: "S19 富迪素材库弹层",
    title: "制作", mode: "icon", iconName: "movie_edit", active: "create",
    right: materialChip(),
    content: [
      wrapText("H2", "这次走哪条路？", "fill_container", { size: 24, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.3 }),
      wrapText("dim", "弹层打开时，制作页仍在下面，对象没有切换。", "fill_container", { size: 13, fill: "$text-muted" }),
    ],
  });
  s19.children.push(frame("Dialog Backdrop", {
    x: 0, y: 0, width: 390, height: 844, layout: "vertical", justifyContent: "center", alignItems: "center",
    fill: "#191C1B99", padding: 24,
  }, [
    frame("Dialog", {
      layout: "vertical", width: 342, gap: 16, padding: 16,
      fill: "$surface-paper", cornerRadius: 16, effect: floatShadow(),
    }, [
      frame("DH", { layout: "horizontal", width: "fill_container", justifyContent: "space_between", alignItems: "center" }, [
        txt("t", "富迪素材库", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
        icon("close", 20, "$action-primary"),
      ]),
      frame("Poster", {
        width: "fill_container", height: 220, cornerRadius: 12,
        fill: { type: "gradient", gradientType: "linear", rotation: 200, colors: [{ color: "#004D40", position: 0 }, { color: "#26A69A", position: 1 }] },
        layout: "vertical", justifyContent: "end", padding: 16,
      }, [
        txt("p", "宣传图占位 · 不读取真实素材库内容", { size: 12, fill: "#FFFFFF" }),
      ]),
    ]),
  ]));

  const s20 = phone({
    name: "S20 模板 · 空态",
    title: "模板", mode: "icon", iconName: "content_paste", active: "templates",
    right: frame("Header New", {
      layout: "horizontal", height: 40, padding: [8, 14], gap: 6, alignItems: "center",
      fill: "$accent-soft", cornerRadius: 999,
    }, [icon("sparkle", 17, "$action-primary"), txt("New", "新建", { size: 13, weight: 600, fill: "$action-primary" })]),
    content: [
      colOf("Hero", 8, [
        eyebrow("REUSABLE STRUCTURE"),
        wrapText("H2", "把拆解方法变成自己的内容模版", "fill_container", { size: 24, weight: 700, fill: "$action-primary", font: "$font-display", lh: 1.3, ls: -0.4 }),
        wrapText("P", "这里只保存公式、步骤与变量槽，不复制原视频、供应商响应或推理内容。", "fill_container", { size: 14, fill: "$text-muted", lh: 1.6 }),
      ]),
      glassCard("Import", [
        emptyState("analytics", "还没有可导入的拆解", "完成一次正式 AI 拆解后，可在这里复制其中的公式、步骤和变量。"),
      ]),
      colOf("Library", 12, [
        colOf("LH", 4, [eyebrow("LOCAL TEMPLATES"), txt("H3", "我的模板", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" })]),
        emptyState("content_paste", "还没有模板", "你可以从拆解保存，也可以从空白结构开始自定义。"),
      ]),
    ],
  });

  const s21 = phone({
    name: "S21 复刻向导 · 建项目",
    title: "按清单复刻", mode: "detail", active: "create", subtitle: "5 项素材 · 清单合计 37 秒",
    content: [
      glassCard("Premise", [
        txt("H2", "怎么复刻这条", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
        wrapText("p", "先拍门店真实环境，再拍服务过程，最后落到到店体验，不夸大承诺。", "fill_container", { size: 14, fill: "$text-subtle", lh: 1.55 }),
        wrapText("l1", "共 5 项素材，清单建议合计 37 秒。", "fill_container", { size: 13, fill: "$text-muted", lh: 1.45 }),
        wrapText("l2", "成片时长按清单合计定下，不用再从固定档位里挑。", "fill_container", { size: 13, fill: "$text-muted", lh: 1.45 }),
        wrapText("l3", "素材齐了以后生成口播、配音和字幕计划；云端配音不可用时会回退到系统语音。确认微调后再回制作页合成成片。", "fill_container", { size: 13, fill: "$text-muted", lh: 1.45 }),
      ]),
      glassCard("Start", [
        txt("H2", "开始准备素材", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
        wrapText("p", "先按这份清单建一个制作项目，之后逐项把拍好的素材放进对应位置。项目会记住每一项对应哪个文件。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.5 }),
        button({ name: "Start", label: "按这份清单建项目", variant: "primary", iconName: "movie_edit", size: "lg", width: "fill_container" }),
      ]),
      wrapText("Foot", "清单来自这条爆款的正式拆解，只说明该拍什么，不代表画面里真的有这些内容。素材始终只留在本机，不会上传。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.5 }),
    ],
  });

  const s22 = phone({
    name: "S22 复刻向导 · 绑定素材",
    title: "按清单复刻", mode: "detail", active: "create", subtitle: "5 项素材 · 清单合计 37 秒",
    content: [
      wrapText("Progress", "已绑定 2/5 项 · 成片 37 秒", "fill_container", { size: 13, weight: 600, fill: "$action-primary" }),
      hint("本地合成至少要 3 个画面。再绑定 1 项就可以生成脚本。"),
      glassCard("Req1", [
        frame("Head", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "start" }, [
          txt("n", "01", { size: 16, weight: 700, fill: "$primary-soft", font: "$font-data" }),
          colOf("T", 3, [
            wrapText("t", "门口实拍，能看见店招", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
            wrapText("s", "环境 · 建议 视频 约 8 秒", "fill_container", { size: 12, fill: "$text-muted" }),
          ], { width: "fill_container" }),
          icon("check_circle", 20, "$status-success"),
        ]),
        wrapText("v", "要拍什么：自然光下拍门店门口，店招完整入画。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
        wrapText("d", "可以这样说：下班路过这里，先看一眼店里在忙什么。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
        frame("Bound", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "center" }, [
          icon("movie_edit", 16, "$action-primary"),
          wrapText("f", "门口实拍 01 · 8.0 秒", "fill_container", { size: 12, fill: "$text-subtle" }),
        ]),
        button({ name: "Swap", label: "换一个", variant: "quiet", iconName: "remove", width: "fill_container" }),
        wrapText("note", "这段草稿只是参考。最终口播会按你真正绑定的素材重写，字幕也按重写后的文案生成。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.4 }),
      ], { padding: 16 }),
      glassCard("Req3", [
        frame("Head", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "start" }, [
          txt("n", "03", { size: 16, weight: 700, fill: "$primary-soft", font: "$font-data" }),
          colOf("T", 3, [
            wrapText("t", "量尺或沟通过程", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
            wrapText("s", "过程 · 建议 视频 约 10 秒", "fill_container", { size: 12, fill: "$text-muted" }),
          ], { width: "fill_container" }),
        ]),
        wrapText("v", "要拍什么：真实量尺或沟通，不摆拍夸张反应。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
        button({ name: "Pick", label: "选这一项的素材", variant: "secondary", iconName: "add", width: "fill_container" }),
      ], { padding: 16 }),
      button({ name: "Compose", label: "生成脚本与字幕", variant: "primary", iconName: "auto_awesome", size: "lg", width: "fill_container" }),
      wrapText("Help", "已绑定的素材会按清单编号从前往后成镜；跳过的项不会留空镜头，后面的素材会往前顶。生成完可以在微调页改时长和文案，再回制作页合成成片。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.5 }),
    ],
  });

  const s23 = phone({
    name: "S23 微调导出",
    title: "微调导出", mode: "detail", active: "create", subtitle: "共 3 个镜头 · 30.0 秒",
    content: [
      hint("这条视频的口播是按拆解结构写的，系统没有看过你上传的画面，所以文字不一定对得上每个镜头，需要你逐镜核对。"),
      glassCard("Global", [
        txt("H2", "字幕模板", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
        wrapText("note", "选中的模板决定字幕的字号、描边和出场方式，导出时逐帧烧录进画面。", "fill_container", { size: 13, fill: "$text-muted", lh: 1.45 }),
        frame("Tpls", { layout: "horizontal", width: "fill_container", gap: 8 }, [
          templateChip("经典逐行", true),
          templateChip("关键词高亮", false),
          templateChip("综艺卡片", false),
        ]),
        wrapText("karaoke", "逐字点亮需要词级时间。这条视频还没有，所以会按降级后的模板烧录。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.4 }),
        wrapText("L1", "主文字", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        frame("Headline", { width: "fill_container", height: 45, padding: [0, 12], layout: "horizontal", alignItems: "center", fill: "$surface-low", stroke: "$outline-soft", strokeWidth: 1, cornerRadius: 12 }, [
          txt("v", "你出时间，我出货", { size: 14, fill: "$text-subtle" }),
        ]),
        wrapText("L2", "旁白语速", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
        wrapText("rate", "1.00 倍 · 只影响本地生成的旁白语速，不改字幕文字。", "fill_container", { size: 12, fill: "$text-muted" }),
      ]),
      colOf("Shots", 12, [
        txt("H2", "逐镜微调", { size: 16, weight: 700, fill: "$action-primary", font: "$font-display" }),
        glassCard("Shot1", [
          frame("Head", { layout: "horizontal", width: "fill_container", gap: 8, alignItems: "center" }, [
            txt("n", "01", { size: 16, weight: 700, fill: "$primary-soft", font: "$font-data" }),
            colOf("T", 2, [
              wrapText("c", "门口实拍", "fill_container", { size: 14, weight: 700, fill: "$action-primary" }),
              wrapText("s", "1 条字幕", "fill_container", { size: 12, fill: "$text-muted" }),
            ], { width: "fill_container" }),
          ]),
          wrapText("L1", "镜头时长  10.0 秒", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          wrapText("L2", "口播", "fill_container", { size: 13, weight: 600, fill: "$text-subtle" }),
          wrapText("n", "先说附近上班族最常犹豫的那件事。", "fill_container", { size: 13, fill: "$text-subtle", lh: 1.45 }),
        ], { padding: 16 }),
      ]),
      wrapText("Foot", "字幕的进出点按文案和模板重新推算，来源是文字长度而不是真实语音，所以只是接近而非逐字对齐。镜头的数量、顺序和画面比例在这里不能改。", "fill_container", { size: 12, fill: "$text-muted", lh: 1.5 }),
    ],
    cta: ctaBar(button({ name: "CTA", label: "保存微调", variant: "primary", size: "lg", width: 358 })),
  });

  const rowH = 20 + 48 + 20 + 12 + PHONE_H;
  const y1 = 2700;
  const y2 = y1 + rowH + SECTION_GAP;
  const y3 = y2 + rowH + SECTION_GAP;
  const y4 = y3 + rowH + SECTION_GAP;

  return [
    screenSection("C · 主路径", 0, y1, "PRIMARY PATH", "/ → /create 入口与 Agent → /templates → /settings", [
      deviceColumn("S1  拆解 · 粘贴链接", s1),
      deviceColumn("S2  拆解 · 上传视频", s2),
      deviceColumn("S3  拆解详情 · 处理中", s3),
      deviceColumn("S4  拆解完成 · AI拆解", s4),
      deviceColumn("S5  制作 · 入口", s5),
      deviceColumn("S6  制作 · Agent 新建", s6),
      deviceColumn("S7  模板", s7),
      deviceColumn("S8  设置", s8),
    ]),
    screenSection("C · 观察与账户", 0, y2, "OBSERVE & ACCOUNT", "/observation/new、报告、档案、AI 连接、应用信息", [
      deviceColumn("S9  AI 观察", s9),
      deviceColumn("S10  观察报告", s10),
      deviceColumn("S11  本地档案", s11),
      deviceColumn("S12  AI 连接", s12),
      deviceColumn("S13  应用信息", s13),
    ]),
    screenSection("C · 制作状态", 0, y3, "PRODUCTION STATES", "/create 复刻选拆解、缺素材、待合成、成片、素材库、模板空态", [
      deviceColumn("S14  拆解完成 · 原始文稿", s14),
      deviceColumn("S15  制作 · 爆款复刻选拆解", s15),
      deviceColumn("S16  制作 · 缺素材", s16),
      deviceColumn("S17  制作 · 待合成", s17),
      deviceColumn("S18  制作 · 成片完成", s18),
      deviceColumn("S19  富迪素材库弹层", s19),
      deviceColumn("S20  模板 · 空态", s20),
    ]),
    screenSection("C · 复刻与微调", 0, y4, "REPLICA & EDIT", "/replica/:taskId 与 /create/:projectId/edit", [
      deviceColumn("S21  复刻向导 · 建项目", s21),
      deviceColumn("S22  复刻向导 · 绑定素材", s22),
      deviceColumn("S23  微调导出", s23),
    ]),
  ];
}

const document = {
  version: "2.17",
  variables,
  children: [
    buildCover(),
    buildColors(),
    buildType(),
    buildSpace(),
    buildIcons(),
    buildRules(),
    ...buildComponents(),
    ...buildScreens(),
  ],
};

function assertNames(node, trail) {
  if (!node.name) throw new Error(`missing name at ${trail}`);
  for (const child of node.children ?? []) assertNames(child, `${trail}/${node.name}`);
}
for (const child of document.children) assertNames(child, "document");

const json = `${JSON.stringify(document, null, 2)}\n`;
writeFileSync(outPath, json, "utf8");
console.log(`Wrote ${outPath}`);
console.log(`nodes created (approx ids): ${seq}`);
console.log(`root children: ${document.children.length}`);
console.log(`bytes: ${Buffer.byteLength(json, "utf8")}`);
