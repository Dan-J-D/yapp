// AudioWorklet: slices the mic stream into overlapping frames and posts them to the main thread,
// where pitch (McLeod via pitchy), RMS and VAD run. ~23 ms hop at 44.1/48 kHz.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options?.processorOptions?.frameSize ?? 2048;
    this.hop = options?.processorOptions?.hop ?? 1024;
    this.buf = new Float32Array(this.size);
    this.fill = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, this.size - this.fill);
      this.buf.set(ch.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.size) {
        this.port.postMessage({ frame: this.buf.slice(0), t: currentTime });
        this.buf.copyWithin(0, this.hop);
        this.fill = this.size - this.hop;
      }
    }
    return true;
  }
}
registerProcessor('yapp-capture', CaptureProcessor);
