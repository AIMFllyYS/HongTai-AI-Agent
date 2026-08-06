import { Icon } from "./Icon";
import { formatTaskTime, type TaskStagePresentation } from "../features/tasks/task-presenters";

export interface TaskProgressStepsProps {
  readonly steps: readonly TaskStagePresentation[];
}

function iconForStatus(status: TaskStagePresentation["status"]) {
  if (status === "succeeded") return "check_circle" as const;
  if (status === "running") return "sync" as const;
  if (status === "failed") return "error" as const;
  if (status === "degraded") return "info" as const;
  return "pending" as const;
}

/** Shows one row per fixed TaskStage and only the latest persisted event for that stage. */
export function TaskProgressSteps({ steps }: TaskProgressStepsProps) {
  return (
    <ol className="progress-steps task-progress-steps">
      {steps.map((step) => {
        const timestamp = formatTaskTime(step.timestamp);
        return (
          <li className={`progress-step progress-step--${step.status}`} data-stage={step.stage} data-sequence={step.sequence} key={step.stage}>
            <span className="progress-step__marker"><Icon name={iconForStatus(step.status)} size={17} /></span>
            <span className="progress-step__body">
              <span className="progress-step__line">
                <strong>{step.label}</strong>
                <span className="progress-step__status">{step.statusLabel}</span>
              </span>
              {step.sequence === undefined ? null : <span className="task-progress-steps__event">事件 #{step.sequence}{timestamp ? ` · ${timestamp}` : ""}</span>}
              {step.detail ? <span className="progress-step__detail">{step.detail}</span> : null}
              {step.progress === undefined ? null : <span className="progress-bar"><span style={{ width: `${step.progress}%` }} /></span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
