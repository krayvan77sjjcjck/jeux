export interface ParseMultiplierOptions {
  minMultiplier?: number;
  maxMultiplier?: number;
}

/**
 * Extracts a multiplier value from OCR or DOM text.
 * Supports decimal dot or comma ("2.45x", "1,87", "14.20x").
 */
export function extractMultiplierFromText(
  rawText: string,
  options: ParseMultiplierOptions = {}
): number | null {
  const minMultiplier = options.minMultiplier ?? 1.0;
  const maxMultiplier = options.maxMultiplier ?? 1_000_000;

  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const cleaned = rawText.trim().replace(/\s+/g, ' ');
  const match = cleaned.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) {
    return null;
  }

  const normalized = match[1].replace(',', '.');
  const value = Number.parseFloat(normalized);

  if (!Number.isFinite(value) || value < minMultiplier || value > maxMultiplier) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

/**
 * Mirrors the PDF's round-completion state machine:
 * When the multiplier stops climbing and holds identical for `requiredStableCount`
 * consecutive readings (default: 5), the round is finalized exactly once.
 */
export class RoundStabilityTracker {
  private lastValue: number | null = null;
  private stableCount = 0;
  private recordedCurrentFreeze = false;
  private readonly requiredStableCount: number;

  constructor(requiredStableCount = 5) {
    this.requiredStableCount = Math.max(2, Math.floor(requiredStableCount));
  }

  public observe(val: number | null): {
    completedRound: number | null;
    stableCount: number;
    currentValue: number | null;
  } {
    if (val === null || !Number.isFinite(val)) {
      return {
        completedRound: null,
        stableCount: this.stableCount,
        currentValue: this.lastValue,
      };
    }

    if (this.lastValue !== null && val === this.lastValue) {
      this.stableCount += 1;
    } else {
      this.lastValue = val;
      this.stableCount = 0;
      this.recordedCurrentFreeze = false;
    }

    if (this.stableCount === this.requiredStableCount && !this.recordedCurrentFreeze) {
      this.recordedCurrentFreeze = true;
      return {
        completedRound: val,
        stableCount: this.stableCount,
        currentValue: this.lastValue,
      };
    }

    return {
      completedRound: null,
      stableCount: this.stableCount,
      currentValue: this.lastValue,
    };
  }

  public reset(): void {
    this.lastValue = null;
    this.stableCount = 0;
    this.recordedCurrentFreeze = false;
  }
}
