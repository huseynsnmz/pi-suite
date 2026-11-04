// Lets the end-to-end runs read and change real files through the same code as the skill's tools.
import { applyChoices } from "../../src/review/apply.mjs";
import { reviewData } from "../../src/review/collect.mjs";

const agent = process.env.PI_CODING_AGENT_DIR;
const [verb, ...args] = process.argv.slice(2);
if (verb === "collect") {
  console.log(JSON.stringify(await reviewData(agent), null, 2));
} else {
  const choices = { bash: [], tools: [], read: [], write: [], domains: [] };
  const lists = { "--bash": "bash", "--tool": "tools", "--sandbox-read": "read", "--sandbox-write": "write", "--sandbox-domain": "domains" };
  for (let i = 0; i < args.length; i += 2) choices[lists[args[i]]].push(args[i + 1]);
  const { refusals, ...result } = applyChoices(agent, choices);
  if (refusals.length > 0) {
    console.error(`Nothing was changed.\n${refusals.join("\n")}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
