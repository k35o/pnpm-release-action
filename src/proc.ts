import { getExecOutput } from '@actions/exec';

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

// silent で実行しつつ、失敗時には捨てられがちな stdout/stderr（pnpm は --json の
// エラー JSON を stdout に出す）の末尾をエラーに含めて診断可能にする。
// label はトークン入りの引数をエラーメッセージに載せないための差し替え表示。
export const runCommand = async (
  cwd: string,
  command: string,
  args: readonly string[],
  options: { readonly label?: string; readonly stream?: boolean } = {},
): Promise<string> => {
  const { exitCode, stdout, stderr } = await getExecOutput(command, [...args], {
    cwd,
    // stream: build や publish のようにユーザーがログを追いたいコマンドはそのまま流す
    silent: options.stream !== true,
    ignoreReturnCode: true,
  });
  if (exitCode !== 0) {
    const detail = `${stderr}\n${stdout}`.trim().slice(-2000);
    const shown = options.label ?? `${command} ${args.join(' ')}`;
    throw new CommandError(
      `\`${shown}\` failed with exit code ${String(exitCode)}${detail === '' ? '' : `:\n${detail}`}`,
    );
  }
  return stdout;
};
