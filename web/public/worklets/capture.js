// AudioWorklet: slices the mic stream into overlapping frames and posts them to the main thread,
// where pitch (McLeod via pitchy), RMS and VAD run. ~23 ms hop at 44.1/48 kHz.
// Each frame is also posted low-passed at 700 Hz (4th-order Butterworth): stripping breath and
// fricative noise above the voice's fundamental lets the pitch tracker hold onto soft speech.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options?.processorOptions?.frameSize ?? 2048;
    this.hop = options?.processorOptions?.hop ?? 1024;
    this.buf = new Float32Array(this.size);
    this.lp = new Float32Array(this.size);
    this.fill = 0;
    // RBJ low-pass biquad, run twice
    const w = (2 * Math.PI * 700) / sampleRate;
    const al = Math.sin(w) / (2 * Math.SQRT1_2);
    const c = Math.cos(w);
    const a0 = 1 + al;
    this.k = { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
    this.st = [new Float64Array(4), new Float64Array(4)]; // x1 x2 y1 y2 per stage
  }
  filter(x) {
    const { b0, b1, b2, a1, a2 } = this.k;
    let v = x;
    for (const s of this.st) {
      const y = b0 * v + b1 * s[0] + b2 * s[1] - a1 * s[2] - a2 * s[3];
      s[1] = s[0];
      s[0] = v;
      s[3] = s[2];
      s[2] = y;
      v = y;
    }
    return v;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.fill] = ch[i];
      this.lp[this.fill] = this.filter(ch[i]);
      if (++this.fill === this.size) {
        this.port.postMessage({ frame: this.buf.slice(0), lp: this.lp.slice(0), t: currentTime });
        this.buf.copyWithin(0, this.hop);
        this.lp.copyWithin(0, this.hop);
        this.fill = this.size - this.hop;
      }
    }
    return true;
  }
}
registerProcessor('yapp-capture', CaptureProcessor);
