import { useState } from "react";
import type { MediaReference } from "@hongtai/core";

import { Icon } from "./Icon";

export interface RuntimeMediaFrameProps {
  readonly media: MediaReference;
  readonly label?: string;
  readonly className?: string;
}

/** Renders only a runtime-provided, display-safe URI. No fixture media fallback is used. */
export function RuntimeMediaFrame({ media, label, className = "" }: RuntimeMediaFrameProps) {
  const [failed, setFailed] = useState(false);
  const description = label ?? media.displayName ?? "已保存媒体";

  if (failed) {
    return <div className={`runtime-media-frame runtime-media-frame--unavailable ${className}`.trim()}><Icon name="error" size={26} /><span>媒体暂时无法展示</span></div>;
  }

  if (media.kind === "video") {
    return <div className={`runtime-media-frame runtime-media-frame--video ${className}`.trim()}><video aria-label={description} controls onError={() => setFailed(true)} preload="metadata" src={media.uri} /></div>;
  }
  if (media.kind === "audio") {
    return <div className={`runtime-media-frame runtime-media-frame--audio ${className}`.trim()}><audio aria-label={description} controls onError={() => setFailed(true)} preload="metadata" src={media.uri} /></div>;
  }
  if (media.kind === "image") {
    return <div className={`runtime-media-frame runtime-media-frame--image ${className}`.trim()}><img alt={description} onError={() => setFailed(true)} src={media.uri} /></div>;
  }
  return <div className={`runtime-media-frame runtime-media-frame--document ${className}`.trim()}><Icon name="file" size={26} /><a href={media.uri}>{description}</a></div>;
}
