/**
 * Flexible task deficit (FTD), after Smouse, Liu & Sylvester (2020), p. 102.
 *
 * desired amount scheduled so far = (PL / DFT) * (now - PST)
 * FTD = desired amount - sum of event lengths already scheduled in the current frame
 *
 * All arguments share one time unit. A positive value means the pattern is behind.
 */
export function flexibleTaskDeficit(
  patternLength: number,
  desiredFrameTime: number,
  elapsedSincePatternStart: number,
  scheduledThisFrame: number,
): number {
  return (patternLength / desiredFrameTime) * elapsedSincePatternStart - scheduledThisFrame;
}
