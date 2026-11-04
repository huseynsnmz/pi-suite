/**
 * pi-sandbox offers no way to ask whether it is on, but it keeps a status while it is. Only the
 * footer's data can read statuses, and Pi only hands that to whoever sets a footer. So this sets
 * one for a moment at the start, which has to happen before any other extension sets its own.
 */
const COMMAND = "sandbox-enable";
const STATUS = "sandbox";

export type StatusReader = { getExtensionStatuses(): ReadonlyMap<string, string> };

export function sandboxInstalled(commands: readonly { name: string }[]): boolean {
  return commands.some((command) => command.name === COMMAND);
}

/** Without a reader the sandbox counts as off, so yolo is refused rather than run unconfined. */
export function sandboxIsOn(reader: StatusReader | undefined): boolean {
  return Boolean(reader?.getExtensionStatuses().get(STATUS));
}

export function loadsFirst(packages: unknown): boolean {
  if (!Array.isArray(packages)) return false;
  const first: unknown = packages[0];
  const source = typeof first === "object" && first !== null ? (first as { source?: unknown }).source : first;
  return typeof source === "string" && /pi-suite(?:@[^/]*)?\/?$/.test(source);
}

type FooterSetter = { setFooter(factory: ((tui: never, theme: never, data: StatusReader) => { render(): string[]; invalidate(): void }) | undefined): void };

export function borrowStatusReader(ui: FooterSetter): StatusReader | undefined {
  let reader: StatusReader | undefined;
  ui.setFooter((_tui, _theme, data) => {
    reader = data;
    return { render: () => [], invalidate() {} };
  });
  ui.setFooter(undefined);
  return reader;
}
