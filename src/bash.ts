/**
 * Decides whether a bash command is safe to run in a restricted mode.
 *
 * This is an allowlist that fails closed. Anything the parser cannot prove
 * read-only is rejected, including shell expansion, redirects, subshells and
 * background jobs, so a false "no" costs a prompt and never a write.
 */

export type BashVerdict = { readOnly: true } | { readOnly: false; reason: string };

const no = (reason: string): BashVerdict => ({ readOnly: false, reason });
const YES: BashVerdict = { readOnly: true };

type ArgCheck = (args: readonly string[]) => string | null;

function rejectFlags(...flags: readonly string[]): ArgCheck {
  return (args) => {
    const hit = args.find((arg) =>
      flags.some((flag) => arg === flag || (flag.startsWith("--") && arg.startsWith(`${flag}=`))),
    );
    return hit === undefined ? null : `${hit} can write or run code`;
  };
}

const noArgs: ArgCheck = (args) => (args.length === 0 ? null : "takes no arguments here");
const anyArgs: ArgCheck = () => null;

const COMMANDS: Readonly<Record<string, ArgCheck>> = {
  basename: anyArgs,
  cat: anyArgs,
  cd: anyArgs,
  cut: anyArgs,
  df: anyArgs,
  diff: anyArgs,
  dirname: anyArgs,
  du: anyArgs,
  echo: anyArgs,
  grep: anyArgs,
  head: anyArgs,
  id: anyArgs,
  jq: anyArgs,
  ls: anyArgs,
  printf: rejectFlags("-v"),
  pwd: noArgs,
  readlink: anyArgs,
  realpath: anyArgs,
  stat: anyArgs,
  tail: anyArgs,
  tr: anyArgs,
  type: anyArgs,
  uname: anyArgs,
  wc: anyArgs,
  which: anyArgs,
  whoami: noArgs,
  date: rejectFlags("-s", "--set"),
  file: rejectFlags("-C", "--compile"),
  tree: rejectFlags("-o"),
  sort: rejectFlags("-o", "--output", "--compress-program"),
  uniq: (args) =>
    args.filter((arg) => !arg.startsWith("-")).length > 1 ? "a second file argument is written to" : null,
  rg: rejectFlags("--pre", "--pre-glob", "--hostname-bin"),
  fd: rejectFlags("-x", "--exec", "-X", "--exec-batch", "-l", "--list-details"),
  find: rejectFlags("-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"),
  git: gitCheck,
};

const GIT_READ_ONLY = new Set(["status", "diff", "log", "show", "blame", "rev-parse", "ls-files", "describe", "shortlog"]);
const GIT_UNSAFE_FLAGS = rejectFlags("--output", "--ext-diff", "--textconv", "-O", "--open-files-in-pager");
const GIT_LIST_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  branch: new Set(["-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "-l", "--show-current"]),
  remote: new Set(["-v", "--verbose"]),
  tag: new Set(["-l", "--list"]),
};

function gitCheck(args: readonly string[]): string | null {
  const [sub, ...rest] = args;
  if (sub === undefined) return "needs a subcommand";
  if (sub.startsWith("-")) return `global option ${sub} is not allowed`;
  if (GIT_READ_ONLY.has(sub)) return GIT_UNSAFE_FLAGS(rest);
  const listFlags = GIT_LIST_FLAGS[sub];
  if (listFlags) {
    const bad = rest.find((arg) => !listFlags.has(arg));
    return bad === undefined ? null : `git ${sub} ${bad} is not a listing`;
  }
  if (sub === "stash" && rest[0] === "list") return null;
  if (sub === "worktree" && rest[0] === "list") return null;
  if (sub === "config" && (rest[0] === "--get" || rest[0] === "--list" || rest[0] === "-l")) return null;
  return `git ${sub} is not on the read-only list`;
}

interface Parsed {
  commands: string[][];
  error?: string;
}

/** Splits a command line into argv lists, refusing anything that needs a real shell. */
function parse(input: string): Parsed {
  const commands: string[][] = [];
  let argv: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;

  const endWord = () => {
    if (inWord) argv.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (argv.length > 0) commands.push(argv);
    argv = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "$" || ch === "`" || ch === "\\") return { commands, error: `${ch} inside double quotes` };
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      endWord();
      continue;
    }
    if (ch === "\n" || ch === ";") {
      endCommand();
      continue;
    }
    if (ch === "|") {
      endCommand();
      if (input[i + 1] === "|") i += 1;
      continue;
    }
    if (ch === "&") {
      if (input[i + 1] !== "&") return { commands, error: "background job" };
      endCommand();
      i += 1;
      continue;
    }
    if ("$`\\<>(){}#!".includes(ch)) return { commands, error: `shell syntax ${ch}` };
    word += ch;
    inWord = true;
  }
  if (quote !== null) return { commands, error: "unbalanced quote" };
  endCommand();
  return { commands };
}

export function classifyBash(input: string): BashVerdict {
  const { commands, error } = parse(input);
  if (error) return no(error);
  if (commands.length === 0) return no("empty command");

  for (const [name, ...args] of commands) {
    if (name === undefined) return no("empty command");
    if (name.includes("/")) return no(`${name} is run by path`);
    if (!Object.hasOwn(COMMANDS, name)) return no(`${name} is not on the read-only list`);
    const problem = (COMMANDS[name] as ArgCheck)(args);
    if (problem) return no(`${name}: ${problem}`);
  }
  return YES;
}
