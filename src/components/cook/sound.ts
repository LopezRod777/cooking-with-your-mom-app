// Alert sound and vibration for finished timers. Audio needs a user gesture,
// so the context is created on the "Start timer" tap (unlockAudio).

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (typeof window === "undefined") return;
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    void ctx.resume().catch(() => {});
  } catch {
    // No audio support. Vibration and the on-screen "Done!" still work.
  }
}

// Three 880 Hz beeps, 300 ms each.
export function playAlert(): void {
  try {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const start = t0 + i * 0.45;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.setValueAtTime(0, start + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    }
  } catch {
    // Ignore: the alert is best-effort.
  }
}

export function vibrate(): void {
  try {
    if (typeof navigator !== "undefined") navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Not supported on this device.
  }
}
