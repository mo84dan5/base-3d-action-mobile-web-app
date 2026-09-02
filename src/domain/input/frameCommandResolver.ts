import { FRAME_COMMAND_PRIORITY, type InputCommand, type InputCommandType } from './inputCommand';

// 同一フレームに複数の押下コマンドが成立した場合は
// ジャンプ > ダッシュ > バースト > スキル > 通常攻撃 の順で 1 つだけ処理する(F03 同時押し)。

const EXCLUSIVE = new Set<InputCommandType>(FRAME_COMMAND_PRIORITY);

function priorityOf(type: InputCommandType): number {
  const index = FRAME_COMMAND_PRIORITY.indexOf(type);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

export function resolveFrameCommands(commands: readonly InputCommand[]): InputCommand[] {
  const winner = commands
    .filter((c) => EXCLUSIVE.has(c.type))
    .reduce<InputCommand | null>(
      (best, c) => (best === null || priorityOf(c.type) < priorityOf(best.type) ? c : best),
      null,
    );
  return commands.filter((c) => !EXCLUSIVE.has(c.type) || c === winner);
}
