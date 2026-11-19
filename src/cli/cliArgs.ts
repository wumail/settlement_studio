/** CLI 参数解析：支持 `--key value` 与 `--key=value`，`--flag` 记为 true */
export interface ParsedArgs {
  readonly command: string;
  readonly positionals: ReadonlyArray<string>;
  readonly flags: ReadonlyMap<string, string | true>;
}

export function parseArgv(argv: ReadonlyArray<string>): ParsedArgs {
  const command = argv[0] ?? '';
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(body, next);
        i += 1;
      } else {
        flags.set(body, true);
      }
      continue;
    }
    positionals.push(token);
  }
  return { command, positionals, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error(`--${name} 需要数字，收到 "${value}"`);
  return num;
}

export function requiredNumber(args: ParsedArgs, name: string): number {
  const value = flagNumber(args, name);
  if (value === undefined) throw new Error(`缺少必填参数 --${name}`);
  return value;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) !== undefined;
}

export function required(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (value === undefined) throw new Error(`缺少必填参数 --${name}`);
  return value;
}

export function requiredPositional(args: ParsedArgs, index: number, label: string): string {
  const value = args.positionals[index];
  if (value === undefined) throw new Error(`缺少必填参数 <${label}>`);
  return value;
}
