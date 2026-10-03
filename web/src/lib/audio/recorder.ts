// Mic capture: MediaRecorder (opus) for upload + AudioWorklet frames for live metrics.
// One mic stream stays open across takes; each start()/stop() pair yields one take.
import { LiveAnalyzer, type LiveFrame, type LiveOptions, type LiveSummary } from './live-metrics';

export interface Take {
  blob: Blob;
  mime: string;
  durationS: number;
  startedAt: number;
  summary: LiveSummary;
  /** Live contour [t, st|null] (client-side tracker; server re-analyses accurately). */
  contour: [number, number | null][];
}

function pickMime(): string {
  const prefs = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  return prefs.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

export class VoiceRecorder {
  private ctx!: AudioContext;
  private stream!: MediaStream;
  private node!: AudioWorkletNode;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private t0 = 0;
  private startedAt = 0;
  private contour: [number, number | null][] = [];
  analyzer!: LiveAnalyzer;
  recording = false;
  onFrame: ((f: LiveFrame) => void) | null = null;

  private constructor(private opts: LiveOptions) {}

  static async open(opts: LiveOptions & { echoCancellation?: boolean } = {}): Promise<VoiceRecorder> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        window.isSecureContext ? 'This browser has no microphone API.' : 'Microphone needs HTTPS — install the Yapp certificate (Settings › Devices) and open the https:// address.',
      );
    }
    const r = new VoiceRecorder(opts);
    r.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // AGC would squash loudness variation and noise suppression smears pitch: keep them off.
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: opts.echoCancellation ?? false,
        channelCount: 1,
      },
    });
    r.ctx = new AudioContext({ latencyHint: 'interactive' });
    await r.ctx.audioWorklet.addModule('/worklets/capture.js');
    const src = r.ctx.createMediaStreamSource(r.stream);
    r.node = new AudioWorkletNode(r.ctx, 'yapp-capture', { processorOptions: { frameSize: 2048, hop: 1024 } });
    const mute = r.ctx.createGain();
    mute.gain.value = 0;
    src.connect(r.node).connect(mute).connect(r.ctx.destination);
    r.analyzer = new LiveAnalyzer(r.ctx.sampleRate, opts);
    r.node.port.onmessage = (e: MessageEvent<{ frame: Float32Array; t: number }>) => {
      const t = r.recording ? e.data.t - r.t0 : e.data.t;
      const f = r.analyzer.process(e.data.frame, t);
      if (r.recording) r.contour.push([Math.round(t * 100) / 100, f.st == null ? null : Math.round(f.st * 100) / 100]);
      r.onFrame?.(f);
    };
    return r;
  }

  get audioContext() {
    return this.ctx;
  }

  /** Seconds since the current take started. */
  elapsed(): number {
    return this.recording ? this.ctx.currentTime - this.t0 : 0;
  }

  async start() {
    if (this.recording) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.analyzer = new LiveAnalyzer(this.ctx.sampleRate, this.opts);
    this.chunks = [];
    this.contour = [];
    const mime = pickMime();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.t0 = this.ctx.currentTime;
    this.startedAt = Date.now();
    this.recording = true;
  }

  async stop(): Promise<Take> {
    if (!this.rec || !this.recording) throw new Error('not recording');
    const rec = this.rec;
    const durationS = this.ctx.currentTime - this.t0;
    this.recording = false;
    await new Promise<void>((res) => {
      rec.onstop = () => res();
      rec.stop();
    });
    const mime = (rec.mimeType || 'audio/webm').split(';')[0];
    return {
      blob: new Blob(this.chunks, { type: mime }),
      mime,
      durationS,
      startedAt: this.startedAt,
      summary: this.analyzer.summary(durationS),
      contour: this.contour,
    };
  }

  /** Abort the current take without producing a blob. */
  cancel() {
    if (this.rec && this.recording) {
      this.recording = false;
      this.rec.onstop = null;
      this.rec.stop();
    }
  }

  close() {
    this.cancel();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
  }
}
