// Energy VAD with an adaptive noise floor. Speech = clearly above the floor, or voiced.
export class Vad {
  floorDb = -60;
  private speechHold = 0;
  constructor(
    private marginDb = 12,
    private hangoverS = 0.2,
  ) {}
  /** Returns true while speaking. dt = seconds since last frame. */
  update(db: number, voiced: boolean, dt: number): boolean {
    // Floor follows quiet frames quickly downward, slowly upward.
    if (db < this.floorDb) this.floorDb = this.floorDb * 0.7 + db * 0.3;
    else if (!voiced) this.floorDb += Math.min(db - this.floorDb, 0.5) * dt * 2;
    this.floorDb = Math.max(-90, Math.min(-25, this.floorDb));
    const loud = db > this.floorDb + this.marginDb;
    if (loud || (voiced && db > this.floorDb + this.marginDb / 2)) this.speechHold = this.hangoverS;
    else this.speechHold = Math.max(0, this.speechHold - dt);
    return this.speechHold > 0;
  }
}
