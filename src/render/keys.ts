/** Macs have no Alt key: it is Option, and terminals never receive Command. */
export function keyLabel(key: string, platform: string = process.platform): string {
	return platform === "darwin" ? key.replace(/\balt\+/g, "option+") : key;
}
