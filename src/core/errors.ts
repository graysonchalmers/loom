/**
 * Errors carry the art-file location (file:line:col) and the chain of assets/ops being built:
 *   walls.tx.js:12:3: material 'brick' > bricks: rows must be a whole number
 */
export class LoomError extends Error {
  loc?: string;
  path: string[];
  detail: string;

  constructor(detail: string, loc?: string, path: string[] = []) {
    super(detail);
    this.name = "LoomError";
    this.detail = detail;
    this.loc = loc;
    this.path = path;
    this.message = this.format();
  }

  format(): string {
    const where = this.loc ? this.loc + ": " : "";
    const path = this.path.length ? this.path.join(" > ") + ": " : "";
    return where + path + this.detail;
  }

  /** Prefix a context step (e.g. "sprite 'x'"); keeps the innermost location. */
  within(step: string, loc?: string): this {
    this.path.unshift(step);
    if (!this.loc && loc) this.loc = loc;
    this.message = this.format();
    return this;
  }
}

/** Wrap any thrown value as a LoomError, pulling an art-file location out of its stack. */
export function wrap(e: unknown, locFromStack?: (stack: string) => string | undefined): LoomError {
  if (e instanceof LoomError) {
    if (!e.loc && e.stack && locFromStack) {
      const loc = locFromStack(e.stack);
      if (loc) { e.loc = loc; e.message = e.format(); }
    }
    return e;
  }
  // Errors thrown inside the art-file sandbox come from another realm: duck-type them.
  const isErr = typeof e === "object" && e !== null && "message" in e;
  const message = isErr ? String((e as Error).message) : String(e);
  const stack = isErr ? (e as Error).stack : undefined;
  return new LoomError(message, stack && locFromStack ? locFromStack(stack) : undefined);
}

/** Levenshtein-based suggestion among candidates. */
export function didYouMean(name: string, candidates: Iterable<string>): string {
  let best = "", bestD = Infinity;
  for (const c of candidates) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return best && bestD <= Math.max(2, Math.floor(name.length / 3)) ? ` (did you mean '${best}'?)` : "";
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
