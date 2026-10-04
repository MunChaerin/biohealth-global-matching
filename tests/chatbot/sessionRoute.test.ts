import { describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "../../app/api/chat/session/route";
import type { ChatbotContext } from "../../lib/chatbot/types";

const context: ChatbotContext = {
  sessionId: "demo-tanaka-haruko",
  patientId: "tanaka-haruko",
  state: "SAFETY_HOLD",
  messages: [{ role: "patient", text: "테스트 위험 발화", createdAt: "2026-10-05T00:00:00.000Z" }],
  subjective: {},
  safetyFlags: [{ type: "suicide", severity: "high", evidence: "테스트 위험 발화" }],
};

describe("chat session route", () => {
  it("등록된 데모 환자의 저장 세션을 초기화한다", async () => {
    expect((await POST(new Request("http://localhost/api/chat/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    }))).status).toBe(200);

    const response = await DELETE(new Request("http://localhost/api/chat/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId: context.patientId, sessionId: context.sessionId }),
    }));
    expect(response.status).toBe(200);

    const loaded = await GET(new Request(`http://localhost/api/chat/session?sessionId=${context.sessionId}`));
    expect(await loaded.json()).toEqual({ context: null });
  });

  it("환자와 일치하지 않는 세션 초기화를 거부한다", async () => {
    const response = await DELETE(new Request("http://localhost/api/chat/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId: "tanaka-haruko", sessionId: "demo-kim-sunja" }),
    }));
    expect(response.status).toBe(400);
  });
});
