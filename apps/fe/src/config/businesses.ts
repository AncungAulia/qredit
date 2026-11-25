export const AGENT_ART = {
  "counterparty-check": "counterparty",
  "sanctions-screen": "sanctions",
  "due-diligence": "diligence",
  "contract-auditor": "auditor",
} as const satisfies Record<string, "counterparty" | "sanctions" | "diligence" | "auditor">;
