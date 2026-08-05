import type { RecentAnalysis, VisualMedia } from "../visual-types";

export const images = {
  workwear:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDHF7BaeMhupCCyu5GSuhOyUDpjpWOK4BsVMcBY-bdG86N2nrDXZ6jIiA1hXB_2ASg0pLMtcocFI5c61Q8UJVrud0f68AtSHAHht4N-LLiVqm0O5S9uCfvRnMGG9E0MJBvnXDsJwQWiXSB2pYff3IGTrwjKDR3ZimohmgT6dMYzXXTeTMQM4V0QT2DQ6-ao06l6P6KmLdqKritEmKHcLN4oirVSfd8lxCxq_8we4PA2RlBzrdTzGXob",
  food:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCr7V0UK5T_m-VPx7zpoD1PkWgx2ET6XKKhLype2Q9tVpe6zUxB3jJJabpHtZ2ZGPTg1F5XUrWBV8o4XHyAvLAZSmrbh516LDOuCJ_cvMtZTO4FOX-WlPGnG_pz4nelLQDba0q9MqLRGhQcko8crgBBrQD3KhnyBIHmGIlSGyBXdDcZYZUlOHCsq73nAtBU3d8USMlNbyV7NzVlKlDJ-6AU4PEGMsm15l1PQ8ebqclqQIatQ68PH1oU",
  device:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuC7dbE1uSVOsNFmWIt7BFp6N7TFr8dwYGH4O5kOeaWJv5c_KVQR2NEO9-S6Sh1TB7jW3_NzVHwfXHGogh1HH3-HJndzJYSNkAUoVRxygZoJ26HXZtJ_Kt4ZML3aCwemaL368v8EQkds3DVBofE6utBm6QdMYkEsxuSfcgplbjWI-mmoAl1_hErbFWrA4pl-Kv8udD1brKUlq1dMsusm8T-YpIsrqC2RHwrvuFadw9Uw4vfTUwt0PUlG",
  store:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuBUeVc5YsjTagWHa-46EoQj-mxwH8NJlK3HInN_UX6dmrWEls2EPHNo1hL8TanKh8Q1D3zdWjrFPNIMPrgX6JS5_3-4RUIQpkQ7F5ZWZyTtr6UgIXvCTtrgwF1s0QV7qBGCroGQI93fp-MYRFk2OtAWvY7mOioVYtBiKGhLn3lSqr10ZpjgsUNKl_O3zSqMB1f8w5nGM0tpiUoUyb9orLIz6GoJoKykPCjcuaSR9s34VB42EoqtiC_t",
  publish:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCzMzudGa5euHDtyUv3q0zEp46JDH0iyrIaWh86Zd3iLqwQAKMWenxbiHp-R4_Af1OXj8ujhMqk286HAgsYHJ-a0YWSOsc9mYhhQG-dJX6i4zGlAh-WPVNiaKB4odAHD2k3NZXpKV6WsLUI_-Hz0yNgdgZKW4gOXyckdOizspq34wdiNbODjESkUPRe1GyukkR9N-XN-3jkQghxGPb2r_bJDXrlSxliU9sgTwHjBtP9b6Y9cil00R5Q",
  create:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDqChGl3VIRsSOn4MRQckbzZ0tbI9Eyw0GZ4xAijRWeoF8uvcgbOeogjGd_p6mg5y6s_k6ZfF55pxG92GQd7nITsMSc3ZVn7yy4ZU_B0phJ6H1yREwX0vSUEN5apF1EE8wQITuj70jlfSA5DyAn19oPMQXrE5vtagEx-FQyM1iZdUCsLEQPgoSUO0zkDELyFD1uH4lIZX0xw5nGM0tpiUoUyb9orLIz6GoJoKykPCjcuaSR9s34VB42EoqtiC_t",
  face:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDKAUYqt68vdUFLg-ym5Jnq6JaGbbNRAIkMj-oTh9yxdc1wIG9JiwRMWjqYoC-zErEKmiq0nVjIpw75nYLPWA_TJJwmZ3EJ56hGiVAGUUmY-sUkLU_RvrqSi9bljSTWyY9e3gi_PVkuHg2HxFrRV-tfD9HXHkVUxGM-SdvJKxOnIMU6tRKFaXpCUbKX5H7aNzlJp8XrNaNHEm6PVD9ZyrH3uwa6v9c9uSnajrkg3R_LUQynd_QCM",
  tongue:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCS1wSeX1NTF2abwJMG_zTRppQvHefW2WFaxN2g_XebnZEyJvfHQYHczlUTriAeQ0u95nMCWZ4clP5dTFtrRHdz3nNUkgHsZa5HP47qKm4A1tL1-ITxxg0r6vj16D9wZ346QpnBz_flg0eX4cc2SwlI2XAlOIIVlazMONgCDus09622HXXIdSR9Rs9JVU_oWGB7sGU1WTgNCKyklCMF9j0tlMCzvvHnNlE9UfHRaY1IB73XwvbqnTq0",
  avatar:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuAJSOJAQK302TJ91Uy9YlS62-GBamDLMRhjhsUVLS0e1Lwk9dyax_gqlGmdbvAXrPVAXHAwAtc7Qjkdj0-wV3I_cq5Du_HjaBCE9dNzJJG-jWY-lSEyFWtvAYCJej3nln3UXj6cXox__n_5b3Sn7tW7psOikOb40vQ4iI14y-CDijMA24G10zVFIW2V6F2pejFTvVbzpCfP44jvMu5pd0dCtPN4JBUqkNs8jMOVTa8wl_dIRcbz-ITC",
} as const;

export const media = (alt: string, tone: VisualMedia["tone"], src?: string, aspectRatio?: string): VisualMedia => ({
  alt,
  tone,
  src,
  aspectRatio,
});

export const recent: readonly RecentAnalysis[] = [
  {
    id: "workwear",
    title: "职场穿搭爆款逻辑拆解",
    updatedAt: "2023-11-24 14:30",
    status: "completed",
    statusLabel: "已完成",
    platform: "douyin",
    media: media("职场穿搭视频封面", "sage", images.workwear, "4 / 5"),
  },
  {
    id: "food",
    title: "美食探店类脚本深度分析",
    updatedAt: "2023-11-23 09:15",
    status: "processing",
    statusLabel: "分析中",
    platform: "xiaohongshu",
    media: media("美食探店视频封面", "warm", images.food, "4 / 5"),
  },
  {
    id: "device",
    title: "数码测评开头3秒抓人技巧",
    updatedAt: "2023-11-22 18:45",
    status: "completed",
    statusLabel: "已完成",
    platform: "bilibili",
    media: media("数码测评视频封面", "forest", images.device, "4 / 5"),
  },
];

export const timeline = [
  {
    id: "hook",
    label: "钩子 (Hook)",
    timeRange: "00:00 - 00:05",
    tone: "primary" as const,
    description: "兄弟们，不想多说了，给我使劲蹬codex。强调强烈推荐，制造悬念。",
    tags: ["痛点共鸣", "利益点前置"],
  },
  {
    id: "value",
    label: "痛点/价值 (Value)",
    timeRange: "00:05 - 00:12",
    tone: "accent" as const,
    description: "点出目标受众（开发的朋友），抛出生产力神器的定位。",
  },
  {
    id: "body",
    label: "正文/干货 (Body)",
    timeRange: "00:12 - 03:30",
    tone: "neutral" as const,
    description: "手把手工作流配置教学（具体步骤略，见原始文稿）。",
  },
  {
    id: "cta",
    label: "行动呼吁 (CTA)",
    timeRange: "03:30 - 03:42",
    tone: "error" as const,
    description: "引导点赞收藏，评论区领取配置清单。",
  },
];
