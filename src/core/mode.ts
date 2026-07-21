import type { ModeWhenClean } from './inputs.ts';

export type Mode = 'version' | 'publish' | 'none';

export const decideMode = (
  hasPendingChanges: boolean,
  modeWhenClean: ModeWhenClean,
): Mode => (hasPendingChanges ? 'version' : modeWhenClean);
