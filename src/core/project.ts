// A project: the materials defined by one art file (and its includes), the DSL that file sees,
// and a build cache. Fields are lazy, so defining is cheap and building happens on demand.
import { LoomError, didYouMean, wrap } from "./errors.ts";
import { Field, Tex, describe, named, resetNamed, setLocator, setPalette } from "./field.ts";
import * as gen from "./gen.ts";
import { type Maps, type MaterialDef, MATERIAL_OPTS, buildMaps, defineMaterial } from "./material.ts";
import { parseHex } from "./util.ts";

export class Project {
  readonly files: string[] = [];
  readonly materials = new Map<string, MaterialDef>();
  readonly order: string[] = [];
  readonly palette = new Map<string, [number, number, number]>();
  includeHook?: (path: string) => void;
  private readonly cache = new Map<string, Maps>();
  nodes: { label: string; loc?: string; node: Field | Tex }[] = [];

  constructor() {
    resetNamed();
    setPalette(this.palette);
    setLocator(() => this.callerLoc());
  }

  addFile(file: string): void { if (!this.files.includes(file)) this.files.push(file); }

  locFromStack(stack: string): string | undefined {
    for (const line of stack.split("\n")) {
      for (const f of this.files) {
        const i = line.indexOf(f + ":");
        if (i < 0) continue;
        const m = /^:(\d+):(\d+)/.exec(line.slice(i + f.length));
        if (m) return `${f.replace(/^.*[\\/]/, "")}:${m[1]}:${m[2]}`;
      }
    }
    return undefined;
  }

  callerLoc(): string | undefined {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 60;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = limit;
    return this.locFromStack(stack);
  }

  /** Call when the file has finished running: captures the fields named with .as(). */
  finish(): void { this.nodes = [...named]; }

  build(name: string, size?: number): Maps {
    const def = this.materials.get(name);
    if (!def) throw new LoomError(`unknown material '${name}'${didYouMean(name, this.order)}`);
    const key = `${name}@${size ?? def.opts.size ?? 512}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    try {
      const m = buildMaps(def, size);
      this.cache.set(key, m);
      return m;
    } catch (e) {
      throw wrap(e, (s) => this.locFromStack(s)).within(`material '${name}'`, def.loc);
    }
  }

  // ---------------------------------------------------------------- DSL

  env(): Record<string, unknown> {
    const guard = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R => {
      try { return fn(...a); } catch (e) { throw wrap(e, (s) => this.locFromStack(s)).within(name, this.callerLoc()); }
    };
    const env: Record<string, unknown> = {
      pal: (colors: unknown) => {
        if (typeof colors !== "object" || colors === null || Array.isArray(colors)) throw new LoomError('pal({ stone: "#7a7f86", moss: "#4f6b2f" })', this.callerLoc());
        for (const [k, v] of Object.entries(colors)) {
          const c = typeof v === "string" ? parseHex(v) ?? this.palette.get(v) : undefined;
          if (!c) throw new LoomError(`pal: '${k}' must be "#rrggbb" or another name, got ${describe(v)}`, this.callerLoc());
          this.palette.set(k, c);
        }
      },
      material: (name: unknown, a?: unknown, b?: unknown) => {
        const loc = this.callerLoc();
        if (typeof name !== "string" || !name) throw new LoomError('material("name", { size }, { height, color, rough, metal, emit, ao })', loc);
        const [opts, ch] = b === undefined ? [{}, a] : [a, b];
        if (typeof opts !== "object" || opts === null) throw new LoomError(`material '${name}': options must be an object`, loc);
        if (typeof ch !== "object" || ch === null || ch instanceof Field || ch instanceof Tex) throw new LoomError(`material '${name}': channels must be an object { height, color, rough, ... }`, loc);
        for (const k of Object.keys(opts)) if (!MATERIAL_OPTS.includes(k)) throw new LoomError(`material '${name}': unknown option '${k}'${didYouMean(k, MATERIAL_OPTS)}`, loc);
        if (this.materials.has(name)) throw new LoomError(`material '${name}' is defined twice`, loc);
        try {
          this.materials.set(name, defineMaterial(name, opts as never, ch as never, loc));
        } catch (e) { throw wrap(e, (s) => this.locFromStack(s)).within(`material '${name}'`, loc); }
        this.order.push(name);
      },
      include: (path: unknown) => {
        if (typeof path !== "string") throw new LoomError('include("other.tx.js")', this.callerLoc());
        if (!this.includeHook) throw new LoomError("include() is not available here", this.callerLoc());
        this.includeHook(path);
      },
    };
    for (const [name, fn] of Object.entries(gen)) env[name] = guard(name, fn as (...a: unknown[]) => unknown);
    return env;
  }
}
