import type { ProcessingStepViewModel } from "../data/visual-types";
import { Icon } from "./Icon";

export interface ProgressStepsProps {
  readonly steps: readonly ProcessingStepViewModel[];
}

function iconForStatus(status: ProcessingStepViewModel["status"]) {
  if (status === "succeeded") return "check_circle" as const;
  if (status === "running") return "sync" as const;
  if (status === "failed") return "error" as const;
  return "pending" as const;
}

export function ProgressSteps({ steps }: ProgressStepsProps) {
  return (
    <ol className="progress-steps">
      {steps.map((step) => (
        <li className={`progress-step progress-step--${step.status}`} key={step.stage}>
          <span className="progress-step__marker"><Icon name={iconForStatus(step.status)} size={17} /></span>
          <span className="progress-step__body">
            <span className="progress-step__line">
              <strong>{step.label}</strong>
              <span className="progress-step__status">{step.statusLabel}</span>
            </span>
            {step.detail ? <span className="progress-step__detail">{step.detail}</span> : null}
            {typeof step.progress === "number" ? <span className="progress-bar"><span style={{ width: `${step.progress}%` }} /></span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
