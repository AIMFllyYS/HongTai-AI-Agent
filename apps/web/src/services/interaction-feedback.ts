export type InteractionFeedbackKind = "press" | "navigate";

let audioContext: AudioContext | null = null;

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;

  const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!AudioContextConstructor) return null;

  try {
    audioContext = new AudioContextConstructor();
    return audioContext;
  } catch {
    return null;
  }
}

function playTone(kind: InteractionFeedbackKind): void {
  const context = getAudioContext();
  if (!context) return;

  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const duration = kind === "navigate" ? 0.022 : 0.016;
    const frequency = kind === "navigate" ? 680 : 760;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.028, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
    void context.resume().catch(() => undefined);
  } catch {
    // Audio is an optional enhancement. A blocked or unavailable context must not block UI input.
  }
}

function vibrate(kind: InteractionFeedbackKind): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;

  try {
    navigator.vibrate(kind === "navigate" ? [8, 3, 8] : 8);
  } catch {
    // Vibration permissions and WebView support vary; silently keep the visual feedback.
  }
}

export function playInteractionFeedback(kind: InteractionFeedbackKind = "press"): void {
  playTone(kind);
  vibrate(kind);
}
