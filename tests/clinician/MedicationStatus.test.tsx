import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MedicationStatus } from "../../components/clinician/MedicationStatus";
import type { TodayMedication } from "../../lib/medication/intakeStore";
import { getMedicationSchedule } from "../../lib/medication/schedule";

const [lyribea, tylenol] = getMedicationSchedule("tanaka-haruko");

const today: TodayMedication = {
  date: "2026-10-01",
  items: [
    { ...lyribea!, status: "taken", takenAt: "2026-10-01T00:05:00.000Z", mismatchCount: 1, lastMismatch: { detectedDrugCode: "K-005849", at: "2026-10-01T00:03:00.000Z" } },
    { ...tylenol!, status: "pending", mismatchCount: 0 },
  ],
  next: { ...tylenol!, status: "pending", mismatchCount: 0 },
  nextGroup: [{ ...tylenol!, status: "pending", mismatchCount: 0 }],
};

describe("MedicationStatus", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(today)))));
  afterEach(() => vi.unstubAllGlobals());

  it("오늘 약별 복용 여부와 다른 약을 비춘 기록을 보여준다", async () => {
    render(<MedicationStatus patientId="tanaka-haruko" />);
    expect(await screen.findByText("1 / 2 복용")).toBeInTheDocument();

    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first!).getByText("리리베아캡슐 50mg 1캡슐")).toBeInTheDocument();
    expect(within(first!).getByText(/^복용 /)).toBeInTheDocument();
    expect(within(first!).getByText(/다른 약을 비춤 1회 · 마지막: 무스판정/)).toBeInTheDocument();
    expect(within(second!).getByText("미복용")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/medication?patientId=tanaka-haruko", { cache: "no-store" });
  });

  it("불러오지 못하면 그렇게 표시한다", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 500 }));
    render(<MedicationStatus patientId="tanaka-haruko" />);
    expect(await screen.findByText("불러오지 못함")).toBeInTheDocument();
  });
});
