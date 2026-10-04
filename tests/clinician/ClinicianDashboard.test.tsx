import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClinicianDashboard } from "../../components/clinician/ClinicianDashboard";
import type { ChatbotContext } from "../../lib/chatbot/types";

vi.mock("../../components/clinician/FacialObservation", () => ({ FacialObservation: () => null }));
vi.mock("../../components/clinician/MedicationStatus", () => ({ MedicationStatus: () => null }));
vi.mock("../../components/motion/useMotionTracking", () => ({
  useMotionTracking: () => ({ videoRef: { current: null }, loading: false }),
}));

const tanakaContext: ChatbotContext = {
  sessionId: "demo-tanaka-haruko",
  patientId: "tanaka-haruko",
  state: "READY_FOR_SOAP",
  messages: [{ role: "patient", text: "허리가 아파요.", createdAt: "2026-10-05T00:00:00.000Z" }],
  subjective: { chiefConcern: "허리 통증", severityNrs: 7 },
  safetyFlags: [],
};

describe("ClinicianDashboard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/chat/session")) {
        const context = url.includes("demo-tanaka-haruko") ? tanakaContext : null;
        return new Response(JSON.stringify({ context }));
      }
      if (url.includes("/api/motion")) return new Response(JSON.stringify({ report: null }));
      if (url.includes("/api/care/call")) return new Response(JSON.stringify({ call: null }));
      return new Response("{}", { status: 404 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("환자를 바꾸면 이전 환자의 SOAP을 지우고 세션이 없는 상태를 표시한다", async () => {
    render(<ClinicianDashboard />);

    expect(await screen.findByText(/주호소: 허리 통증/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "환자 선택" }), { target: { value: "kim-sunja" } });

    await waitFor(() => {
      expect(screen.getByText("환자 대화 정보가 아직 수집되지 않았습니다.")).toBeInTheDocument();
    });
    expect(screen.queryByText(/주호소: 허리 통증/)).not.toBeInTheDocument();
  });
});
