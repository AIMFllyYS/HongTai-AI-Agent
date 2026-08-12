import { useEffect, useState } from "react";
import type { MediaReference } from "@hongtai/core";

import { Icon } from "./Icon";

export interface RuntimeMediaFrameProps {
  readonly media: MediaReference;
  readonly label?: string;
  readonly className?: string;
}

type MediaOrientation = "portrait" | "landscape" | "square";

interface MediaAspect {
  readonly ratio: string;
  readonly orientation: MediaOrientation;
}

function mediaAspect(width: number | undefined, height: number | undefined): MediaAspect | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width === undefined || height === undefined || width <= 0 || height <= 0) return undefined;
  return {
    ratio: `${width} / ${height}`,
    orientation: width === height ? "square" : width > height ? "landscape" : "portrait",
  };
}

/** Renders only a runtime-provided, display-safe URI. No fixture media fallback is used. */
export function RuntimeMediaFrame({ media, label, className = "" }: RuntimeMediaFrameProps) {
  const [failed, setFailed] = useState(false);
  const [measuredAspect, setMeasuredAspect] = useState<MediaAspect>();
  const description = label ?? media.displayName ?? "已保存媒体";
  const declaredAspect = mediaAspect(media.width, media.height);
  const aspect = measuredAspect ?? declaredAspect;

  useEffect(() => {
    setFailed(false);
    setMeasuredAspect(undefined);
  }, [media.uri]);

  if (failed) {
    return <div className={`runtime-media-frame runtime-media-frame--unavailable ${className}`.trim()}><Icon name="error" size={26} /><span>媒体暂时无法展示</span></div>;
  }

  if (media.kind === "video") {
    return (
      <div
        className={`runtime-media-frame runtime-media-frame--video ${className}`.trim()}
        data-media-orientation={aspect?.orientation ?? "unknown"}
        style={aspect ? { aspectRatio: aspect.ratio } : undefined}
      >
        <video
          aria-label={description}
          controls
          onError={() => setFailed(true)}
          onLoadedMetadata={(event) => setMeasuredAspect(mediaAspect(event.currentTarget.videoWidth, event.currentTarget.videoHeight))}
          preload="metadata"
          src={media.uri}
        />
      </div>
    );
  }
  if (media.kind === "audio") {
    return <div className={`runtime-media-frame runtime-media-frame--audio ${className}`.trim()}><audio aria-label={description} controls onError={() => setFailed(true)} preload="metadata" src={media.uri} /></div>;
  }
  if (media.kind === "image") {
    return <div className={`runtime-media-frame runtime-media-frame--image ${className}`.trim()}><img alt={description} onError={() => setFailed(true)} src={media.uri} /></div>;
  }
  return <div className={`runtime-media-frame runtime-media-frame--document ${className}`.trim()}><Icon name="file" size={26} /><a href={media.uri}>{description}</a></div>;
}
