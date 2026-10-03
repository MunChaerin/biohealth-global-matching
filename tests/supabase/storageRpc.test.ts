import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  requireProductionStorage: () => undefined,
  getSupabaseAdmin: () => ({ rpc: mocks.rpc }),
  assertSupabaseResult: (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  },
}));

import { saveCameraReport } from "../../lib/camera/reportStore";
import { recordRecognition, recordTaken } from "../../lib/medication/intakeStore";
import { saveMotionReport } from "../../lib/motion/motionStore";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("Supabase atomic storage RPCs", () => {
  it("stores camera and motion reports only through latest-value RPCs", async () => {
    await saveCameraReport({
      patientId: "tanaka-haruko",
      measuredAt: "2026-10-03T10:00:00.000Z",
      status: "off",
    });
    await saveMotionReport({
      patientId: "tanaka-haruko",
      measuredAt: "2026-10-03T10:00:00.000Z",
      status: "present",
      movementLevel: "moving",
      stillnessSeconds: 0,
      absenceSeconds: 0,
      lastDetectedAt: "2026-10-03T10:00:00.000Z",
      lastMovementAt: "2026-10-03T10:00:00.000Z",
      cameraConnected: true,
    });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "save_camera_report_if_newer", expect.objectContaining({ p_patient_id: "tanaka-haruko" }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "save_motion_report_if_newer", expect.objectContaining({ p_patient_id: "tanaka-haruko" }));
  });

  it("records taken and recognition events through merge-safe RPCs", async () => {
    const now = new Date("2026-10-03T10:00:00.000Z");
    await recordTaken("tanaka-haruko", "tanaka-lyribea-am", "camera", now);
    await recordRecognition("tanaka-haruko", "tanaka-lyribea-am", {
      patientId: "tanaka-haruko",
      medicationCode: "K-004378",
      expectedMedicationCode: "K-045037",
      confidence: 0.91,
      status: "mismatched",
      modelVersion: "pill-yolo11n-10cls-v1",
      measuredAt: now.toISOString(),
    }, now);

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "record_medication_taken", expect.objectContaining({ p_medication_id: "tanaka-lyribea-am" }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "record_medication_recognition", expect.objectContaining({
      p_is_mismatch: true,
      p_detected_drug_code: "K-004378",
    }));
  });
});
