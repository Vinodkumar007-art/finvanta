import { describe, expect, it } from "vitest";
import { systemPrompt } from "@/services/ai/agents";
import { routeAgentForPrompt } from "@/services/ai/agent-routing";

describe("routeAgentForPrompt", () => {
  it.each([
    ["Prepare a GST return review", "tax"],
    ["Analyze my financial ratios", "analyst"],
    ["Compare RELIANCE and TCS on NSE", "indian-equity"],
    ["Write an Excel formula for ageing", "data"],
    ["Give me a CFO briefing", "cfo"],
    ["Say the top 10 movies", "general"],
  ] as const)("routes %s to %s", (prompt, expectedAgent) => {
    expect(routeAgentForPrompt(prompt)).toBe(expectedAgent);
  });

  it("gives the assistant navigation links and requires verified data for record explanations", () => {
    const prompt = systemPrompt("general", { company: "Example", fy: "2025-26", currency: "INR" });
    expect(prompt).toContain("[Accounting](/accounting)");
    expect(prompt).toContain("retrieve it with an available tool instead of guessing");
    expect(prompt).toContain("never perform an unapproved write");
  });
});
