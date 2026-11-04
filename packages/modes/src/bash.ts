/**
 * Decides whether a bash command is safe to run in a restricted mode.
 *
 * This is an allowlist that fails closed. Anything the parser cannot prove
 * read-only is rejected, including shell expansion, globs, redirects, subshells
 * and background jobs, so a false "no" costs a prompt and never a write. Globs
 * count because a file named -exec could turn a pattern into a dangerous flag.
 */

export type BashVerdict = { readOnly: true } | { readOnly: false; reason: string };

const no = (reason: string): BashVerdict => ({ readOnly: false, reason });
const YES: BashVerdict = { readOnly: true };

type ArgCheck = (args: readonly string[]) => string | null;

const noArgs: ArgCheck = (args) => (args.length === 0 ? null : "takes no arguments here");
const anyArgs: ArgCheck = () => null;

/**
 * Rejects a long option if its name could abbreviate a forbidden one, because
 * getopt_long and git both accept unique prefixes such as --outp for --output.
 */
function isForbiddenLong(arg: string, forbidden: readonly string[]): boolean {
  if (!arg.startsWith("--")) return false;
  const name = arg.slice(2).split("=", 1)[0] as string;
  return name !== "" && forbidden.some((flag) => flag.startsWith(name));
}

function rejectLong(...forbidden: readonly string[]): ArgCheck {
  return (args) => {
    const hit = args.find((arg) => isForbiddenLong(arg, forbidden));
    return hit === undefined ? null : `${hit} can write or run code`;
  };
}

/**
 * Only these flags are allowed. A denylist can't model parsers that accept
 * bundles and attached values, such as -uo or -ofile.
 */
function onlyFlags(allowed: RegExp, maxOperands = Number.POSITIVE_INFINITY): ArgCheck {
  return (args) => {
    let operands = 0;
    for (const arg of args) {
      if (arg.startsWith("-")) {
        if (!allowed.test(arg)) return `${arg} is not an allowed option`;
      } else {
        operands += 1;
      }
    }
    return operands > maxOperands ? "too many file arguments" : null;
  };
}

const FIND_UNSAFE = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);

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
  date: (args) => (args.every((arg) => arg === "-u" || arg.startsWith("+")) ? null : "can only print the date"),
  printf: (args) => (args[0]?.startsWith("-") ? "options are not allowed" : null),
  sort: onlyFlags(/^-(?:[bdfghinrsuVM]+|k[\w.,]*|t.?)$/),
  uniq: onlyFlags(/^-[cdui]+$/, 1),
  rg: rejectLong("pre", "pre-glob", "hostname-bin"),
  find: (args) => {
    const hit = args.find((arg) => FIND_UNSAFE.has(arg));
    return hit === undefined ? null : `${hit} can write or run code`;
  },
  git: gitCheck,
};

const GIT_READ_ONLY = new Set(["status", "diff", "log", "show", "blame", "rev-parse", "ls-files", "describe", "shortlog"]);
const GIT_UNSAFE_LONG = ["output", "ext-diff", "textconv", "open-files-in-pager"];
const GIT_LIST_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  branch: new Set(["-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "-l", "--show-current"]),
  remote: new Set(["-v", "--verbose"]),
  tag: new Set(["-l", "--list"]),
};

function gitCheck(args: readonly string[]): string | null {
  const [sub, ...rest] = args;
  if (sub === undefined) return "needs a subcommand";
  if (sub.startsWith("-")) return `global option ${sub} is not allowed`;
  if (GIT_READ_ONLY.has(sub)) {
    const hit = rest.find((arg) => arg.startsWith("-O") || isForbiddenLong(arg, GIT_UNSAFE_LONG));
    return hit === undefined ? null : `${hit} can write or run code`;
  }
  const listFlags = GIT_LIST_FLAGS[sub];
  if (listFlags) {
    const bad = rest.find((arg) => !listFlags.has(arg));
    return bad === undefined ? null : `git ${sub} ${bad} is not a listing`;
  }
  const exact = rest.join(" ");
  if ((sub === "stash" || sub === "worktree") && exact === "list") return null;
  if (sub === "config") {
    if (exact === "--list" || exact === "-l") return null;
    if (rest.length === 2 && rest[0] === "--get" && !rest[1]?.startsWith("-")) return null;
  }
  return `git ${sub} is not on the read-only list`;
}

interface Parsed {
  commands: string[][];
  error?: string;
}

/** Splits a command line into argv lists, refusing anything that needs a real shell. */
function parse(input: string): Parsed {
  // Includes quoted text: these bytes can disguise a command in a terminal.
  if (/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(input)) return { commands: [], error: "control character" };

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
    if ("$`\\<>(){}#!*?[]".includes(ch)) return { commands, error: `shell syntax ${ch}` };
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
  // Whether git is safe depends on the folder, and only the session's own folder gets checked.
  if (commands.some(([name]) => name === "cd") && runsGit(input)) return no("git after cd runs in a folder that can't be checked");

  for (const [name, ...args] of commands) {
    if (name === undefined) return no("empty command");
    if (name.includes("/")) return no(`${name} is run by path`);
    if (!Object.hasOwn(COMMANDS, name)) return no(`${name} is not on the read-only list`);
    const problem = (COMMANDS[name] as ArgCheck)(args);
    if (problem) return no(`${name}: ${problem}`);
  }
  return YES;
}

/** Whether a command that passed classifyBash runs git, which depends on the repository too. See git-safety.ts. */
export function runsGit(input: string): boolean {
  return parse(input).commands.some(([name]) => name === "git");
}
