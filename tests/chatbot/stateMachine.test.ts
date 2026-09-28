import { describe, expect, it } from "vitest";
import { nextMissingField, transitionAfterSafety } from "../../lib/chatbot/stateMachine.js";

describe("chatbot state machine helpers", () => {
  it("moves to safety hold when a safety flag exists", () => {
    expect(transitionAfterSafety(true)).toBe("SAFETY_HOLD");
    expect(transitionAfterSafety(false)).toBe("CHIEF_CONCERN");
  });

  it("returns the first missing field", () => {
    expect(nextMissingField({ chiefConcern: "허리 통증" }, ["chiefConcern", "location"])).toBe("location");
    expect(nextMissingField({ chiefConcern: "허리 통증", location: "허리" }, ["chiefConcern", "location"])).toBeUndefined();
  });
});
