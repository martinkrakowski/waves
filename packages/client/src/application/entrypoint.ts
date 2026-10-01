export interface CliIo {
  readonly err: (line: string) => void;
}

const EXIT_NOT_IMPLEMENTED = 2;

export function main(argv: readonly string[], io: CliIo): number {
  const command = argv[0];
  const name = command === undefined ? "waves" : `waves ${command}`;
  io.err(`${name}: not implemented yet`);
  return EXIT_NOT_IMPLEMENTED;
}
