// Hermes agents with cards on the Agents tab. Bernie is Hermes on the Mac;
// Edward and Lucy are Hermes profiles on the PC. Each host's exporter writes
// the agent's snapshot to shared/<id>/subagents.json (hermesSubagentsFileFor
// in runtime-config). No node imports here: client components use it too.
export const HERMES_AGENT_NAMES: Record<string, string> = {
  bernie: "Bernie",
  edward: "Edward",
  lucy: "Lucy",
};

// Own keys only: ids reach the API from query strings and become share paths.
export function isHermesAgent(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(HERMES_AGENT_NAMES, id);
}
