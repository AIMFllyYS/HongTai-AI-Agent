import type { DiagnosisSessionRecord, MediaReference, ObservationMode } from "@hongtai/core";

import { Button } from "../../components/Buttons";
import { Icon } from "../../components/Icon";
import { RuntimeMediaFrame } from "../../components/RuntimeMediaFrame";
import { Sheet } from "../../components/Sheet";
import { useLongPress } from "../../hooks/useLongPress";
import { formatTaskTime } from "../tasks/task-presenters";

export const OBSERVATION_FACE_SCAN_SRC = "/design/observation-face-scan.png";
export const OBSERVATION_TONGUE_SCAN_SRC = "/design/observation-tongue-scan.png";

export type ObservationImageSource = "album" | "camera" | "recovery";

export function observationHistoryTitle(mode: ObservationMode): string {
  return mode === "tongue" ? "舌象分析" : "面部分析";
}

export function observationScanCaption(mode: ObservationMode): string {
  return mode === "tongue"
    ? "自然光下拍摄舌面，避免滤镜和强色光"
    : "自然光下正面拍摄，避免滤镜和强色光";
}

export function observationConfirmMeta(source: ObservationImageSource): string {
  if (source === "camera") return "来自拍摄 · 仅保存在本机";
  if (source === "album") return "来自相册 · 仅保存在本机";
  return "来自本机 · 仅保存在本机";
}

export function observationHistoryBadge(session: DiagnosisSessionRecord): { readonly label: string; readonly tone: "ok" | "run" | "wait" | "fail" } {
  if (session.reportStatus === "succeeded") return { label: "已完成", tone: "ok" };
  if (session.reportStatus === "running") return { label: "进行中", tone: "run" };
  if (session.reportStatus === "pending") return { label: "等待中", tone: "wait" };
  return { label: "未完成", tone: "fail" };
}

export function observationSessionCanBeDeleted(session: DiagnosisSessionRecord): boolean {
  return session.reportStatus === "succeeded" || session.reportStatus === "failed";
}

export interface ObservationCapturePanelProps {
  readonly mode: ObservationMode;
  readonly image: MediaReference | undefined;
  readonly importing: boolean;
  readonly busy: boolean;
  readonly diagnosisAvailable: boolean;
  readonly onScan: () => void;
  readonly onCapture: () => void;
  readonly onPick: () => void;
}

export function ObservationCapturePanel({
  mode,
  image,
  importing,
  busy,
  diagnosisAvailable,
  onScan,
  onCapture,
  onPick,
}: ObservationCapturePanelProps) {
  const plate = mode === "tongue" ? OBSERVATION_TONGUE_SCAN_SRC : OBSERVATION_FACE_SCAN_SRC;
  const disabled = !diagnosisAvailable || busy || importing;
  const showPrompt = importing || !image;

  return (
    <section className="observation-capture-zone">
      <article className="observation-capture-card">
        <button className="observation-capture-card__scan" disabled={disabled} onClick={onScan} type="button">
          <img alt="" className="observation-capture-card__plate" src={plate} />
          {image && !importing ? <RuntimeMediaFrame className="observation-capture-card__image" label={`${mode === "tongue" ? "舌象" : "面部"}图片`} media={image} /> : null}
          <span aria-hidden="true" className="observation-capture-card__laser" />
          <span aria-hidden="true" className="observation-capture-card__brackets">
            <i /><i /><i /><i />
          </span>
          {showPrompt ? (
            <div aria-live="polite" className="observation-capture-card__empty" role={importing ? "status" : undefined}>
              {importing ? <Icon name="sync" size={30} /> : null}
              {importing ? <strong>正在导入图片</strong> : <span>{observationScanCaption(mode)}</span>}
            </div>
          ) : null}
        </button>
        <div className="observation-capture-card__strip">
          <strong>{mode === "tongue" ? "舌象观察" : "面部观察"}</strong>
          <span className="observation-capture-card__badge">{image && !importing ? "已选择" : "点击添加"}</span>
        </div>
      </article>
      <div className="observation-capture-card__actions">
        <Button disabled={disabled} icon={<Icon name="camera" size={15} />} onClick={onCapture} variant="secondary">拍摄照片</Button>
        <Button disabled={disabled} icon={<Icon name="upload_file" size={15} />} onClick={onPick} variant="secondary">相册选择</Button>
      </div>
    </section>
  );
}

export interface ObservationPhotoConfirmSheetProps {
  readonly open: boolean;
  readonly image: MediaReference | undefined;
  readonly source: ObservationImageSource;
  readonly confirming: boolean;
  readonly diagnosisAvailable: boolean;
  readonly importing: boolean;
  readonly onClose: () => void;
  readonly onReselect: () => void;
  readonly onConfirm: () => void;
}

export function ObservationPhotoConfirmSheet({
  open,
  image,
  source,
  confirming,
  diagnosisAvailable,
  importing,
  onClose,
  onReselect,
  onConfirm,
}: ObservationPhotoConfirmSheetProps) {
  return (
    <Sheet className="observation-confirm-sheet" labelledBy="observation-confirm-title" onClose={onClose} open={open} title="请问是否选择这张照片？">
      <p className="observation-confirm-caption">确认后将开始生成本地观察报告。结果仅供日常参考，不是疾病诊断。</p>
      {image ? <RuntimeMediaFrame className="observation-confirm-preview" label="已选图片" media={image} /> : null}
      <p className="observation-confirm-meta"><Icon name="folder_special" size={14} />{observationConfirmMeta(source)}</p>
      <div className="observation-confirm-actions">
        <Button onClick={onReselect} variant="secondary">重新选择</Button>
        <Button className={confirming ? "is-busy" : ""} disabled={!diagnosisAvailable || !image || confirming || importing} onClick={onConfirm} variant="primary">确认使用</Button>
      </div>
    </Sheet>
  );
}

export interface ObservationHistoryCardProps {
  readonly session: DiagnosisSessionRecord;
  readonly onOpen: () => void;
  readonly onLongPress: () => void;
}

export function ObservationHistoryCard({ session, onOpen, onLongPress }: ObservationHistoryCardProps) {
  const badge = observationHistoryBadge(session);
  const time = formatTaskTime(session.updatedAt);
  const longPress = useLongPress({ onLongPress });

  return (
    <article aria-label={`${observationHistoryTitle(session.mode)}，长按管理记录`} className="observation-history-card" {...longPress}>
      <RuntimeMediaFrame className="observation-history-card__photo" label={observationHistoryTitle(session.mode)} media={session.image} />
      <div className="observation-history-card__body">
        <div className="observation-history-card__title">
          <strong>{observationHistoryTitle(session.mode)}</strong>
          <span className={`observation-history-card__badge is-${badge.tone}`}>{badge.label}</span>
        </div>
        <p>{badge.label === "已完成" ? "本地观察已保存" : badge.label}</p>
        <small>{time ? `${time} · 本地保存` : "本地保存"}</small>
      </div>
      <button className="observation-history-card__detail" onClick={onOpen} type="button">
        详情
        <Icon name="chevron_right" size={14} />
      </button>
    </article>
  );
}
