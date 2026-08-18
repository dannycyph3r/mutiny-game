/**
 * Chiptune SFX, synthesised.
 *
 * No audio files. Every sound is a short oscillator envelope, which keeps the
 * whole game under a few hundred kilobytes and means there is nothing to load
 * before the first frame. It also sounds correct for the era the art is
 * borrowing from.
 */

type Voice = 'shoot' | 'hit' | 'kill' | 'hurt' | 'pickup' | 'ability' | 'deny' | 'wave' | 'select';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function initAudio(): void {
  if (ctx) return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
}

export function setMuted(next: boolean): void {
  muted = next;
  if (master) master.gain.value = next ? 0 : 0.22;
}

export function isMuted(): boolean {
  return muted;
}

interface Spec {
  type: OscillatorType;
  from: number;
  to: number;
  ms: number;
  gain: number;
  noise?: boolean;
}

const SPECS: Record<Voice, Spec> = {
  shoot: { type: 'square', from: 620, to: 240, ms: 70, gain: 0.16 },
  hit: { type: 'square', from: 320, to: 180, ms: 60, gain: 0.14 },
  kill: { type: 'sawtooth', from: 240, to: 60, ms: 180, gain: 0.2 },
  hurt: { type: 'sawtooth', from: 180, to: 70, ms: 260, gain: 0.26 },
  pickup: { type: 'triangle', from: 520, to: 980, ms: 150, gain: 0.2 },
  ability: { type: 'square', from: 200, to: 880, ms: 260, gain: 0.2 },
  deny: { type: 'square', from: 180, to: 120, ms: 180, gain: 0.18 },
  wave: { type: 'triangle', from: 300, to: 720, ms: 420, gain: 0.22 },
  select: { type: 'square', from: 880, to: 880, ms: 40, gain: 0.1 },
};

export function play(voice: Voice): void {
  if (!ctx || !master || muted) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const spec = SPECS[voice];
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.from, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), now + spec.ms / 1000);

  gain.gain.setValueAtTime(spec.gain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.ms / 1000);

  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + spec.ms / 1000 + 0.02);
}
