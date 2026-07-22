export type PlanEntry = {
  readonly name: string;
  readonly currentVersion: string;
  readonly newVersion: string;
};

export class PlanParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PlanParseError';
  }
}

// `pnpm version -r --json` はプランがあるときだけ JSON 配列を出し、空のときは
// "No pending changes." というプレーンテキストを exit 0 で出す（実測）。
export const parsePlanOutput = (stdout: string): PlanEntry[] => {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('[')) {
    if (trimmed === '' || trimmed.includes('No pending changes')) return [];
    throw new PlanParseError(
      `unexpected \`pnpm version -r --json\` output (pnpm contract may have changed): ${trimmed.slice(0, 200)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new PlanParseError(
      `\`pnpm version -r --json\` printed invalid JSON: ${trimmed.slice(0, 200)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new PlanParseError(
      'expected a JSON array from `pnpm version -r --json`',
    );
  }
  return parsed.map((entry: unknown, index: number): PlanEntry => {
    if (typeof entry !== 'object' || entry === null) {
      throw new PlanParseError(`plan entry ${String(index)} is not an object`);
    }
    const { name, currentVersion, newVersion } = entry as Record<
      string,
      unknown
    >;
    if (
      typeof name !== 'string' ||
      typeof currentVersion !== 'string' ||
      typeof newVersion !== 'string'
    ) {
      throw new PlanParseError(
        `plan entry ${String(index)} is missing name/currentVersion/newVersion strings`,
      );
    }
    return { name, currentVersion, newVersion };
  });
};
