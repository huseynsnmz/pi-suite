// Stands in for pi-router, so these checks don't depend on it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerVirtualModel({
    provider: "router",
    id: "auto",
    name: "Auto",
    route: (_request, ctx) => ({ model: ctx.modelRegistry.find("mock", "m")!, thinkingLevel: "off" }),
  });
  pi.events.on("pi-router:reader-model", (probe) => {
    if (process.env.FAKE_ROUTER_READER) (probe as { model?: string }).model = process.env.FAKE_ROUTER_READER;
  });
}
