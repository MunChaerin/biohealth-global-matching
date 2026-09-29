import { describe, expect, it } from "vitest";
import { detectSafetyFlags } from "../../lib/chatbot/safetyRules.js";

describe("chatbot safety rules", () => {
  it("detects suicide-related high-risk language", () => {
    const flags = detectSafetyFlags("죽고 싶다는 생각이 들어요.");
    expect(flags).toHaveLength(1);
    expect(flags[0]?.type).toBe("suicide");
    expect(flags[0]?.severity).toBe("high");
  });

  it("returns no flags for a normal symptom statement", () => {
    expect(detectSafetyFlags("허리가 조금 뻐근해요.")).toEqual([]);
  });
});
