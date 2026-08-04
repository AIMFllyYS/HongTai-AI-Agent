import { useState } from "react";
import type { VisualMedia } from "../data/visual-types";
import { Icon } from "./Icon";

export interface MediaFrameProps {
  readonly media: VisualMedia;
  readonly className?: string;
  readonly showPlay?: boolean;
  readonly children?: React.ReactNode;
}

export function MediaFrame({ media, className = "", showPlay = false, children }: MediaFrameProps) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`media-frame media-frame--${media.tone} ${className}`.trim()} style={{ aspectRatio: media.aspectRatio ?? "16 / 9" }}>
      {media.src && !failed ? <img alt={media.alt} onError={() => setFailed(true)} src={media.src} /> : <span className="media-frame__fallback" aria-label={media.alt}><Icon name="sparkle" size={32} /></span>}
      {showPlay ? <span className="media-frame__play"><Icon name="play" size={28} /></span> : null}
      {children}
    </div>
  );
}
