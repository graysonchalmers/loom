// Loads material files (.js or .ts) into a Project by running them in a vm sandbox whose globals
// are the DSL. Each load gets a fresh context, so reloading after an edit is clean.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import * as vm from "node:vm";
import { LoomError, wrap } from "../core/errors.ts";
import { Project } from "../core/project.ts";
import { readImage } from "./image.ts";

function compile(code: string, file: string): string {
  // Type stripping keeps every line and column in place, so error locations stay exact.
  return /\.[cm]?ts$/.test(file) ? stripTypeScriptTypes(code, { mode: "strip" }) : code;
}

/** Load a material file from disk. Throws LoomError with a file:line:col location on failure. */
export function loadProject(file: string): Project {
  const p = new Project();
  const ctx = vm.createContext({ ...p.env(), console, Math });
  const stack: string[] = [];
  const run = (path: string) => {
    const abs = resolve(path);
    if (stack.includes(abs)) throw new LoomError(`include cycle: ${[...stack, abs].join(" -> ")}`);
    let code: string;
    try { code = readFileSync(abs, "utf8"); } catch {
      throw new LoomError(`cannot read material file '${abs}'`, p.callerLoc());
    }
    p.addFile(abs);
    stack.push(abs);
    try {
      vm.runInContext(compile(code, abs), ctx, { filename: abs });
    } catch (e) {
      throw syntaxAware(e, abs, p);
    } finally {
      stack.pop();
    }
  };
  p.includeHook = (path) => run(isAbsolute(path) ? path : resolve(dirname(stack[stack.length - 1]), path));
  p.pathHook = (path) => (isAbsolute(path) ? path : resolve(dirname(stack[stack.length - 1] ?? resolve(file)), path));
  p.imageHook = readImage;
  run(file);
  p.finish();
  return p;
}

/** Load art source from a string (tests, embedding). `name` appears in error locations. */
export function loadSource(src: string, name = "materials.tx.js"): Project {
  const p = new Project();
  const ctx = vm.createContext({ ...p.env(), console, Math });
  p.addFile(name);
  p.imageHook = readImage;
  try {
    vm.runInContext(compile(src, name), ctx, { filename: name });
  } catch (e) {
    throw syntaxAware(e, name, p);
  }
  p.finish();
  return p;
}

function syntaxAware(e: unknown, file: string, p: Project): LoomError {
  const err = wrap(e, (s) => p.locFromStack(s));
  // SyntaxErrors put the location in the first stack line ("file:line").
  if (!err.loc && typeof e === "object" && e && "stack" in e) {
    const m = new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(\\d+)").exec(String((e as Error).stack));
    if (m) err.loc = `${file.replace(/^.*[\\/]/, "")}:${m[1]}`;
    err.message = err.format();
  }
  return err;
}
