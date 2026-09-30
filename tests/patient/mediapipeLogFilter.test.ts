import { afterEach, describe, expect, it, vi } from "vitest";

describe("filterMediapipeInfoLogs", () => {
  const original = console.error;
  afterEach(() => {
    console.error = original;
    vi.resetModules();
  });

  it("MediaPipe의 INFO 로그만 걸러내고 나머지 오류는 그대로 전달한다", async () => {
    const sink = vi.fn();
    console.error = sink;
    const { filterMediapipeInfoLogs } = await import("../../components/patient/useFaceExpression");
    filterMediapipeInfoLogs();

    console.error("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.");
    expect(sink).not.toHaveBeenCalled();

    console.error("real error", 1);
    expect(sink).toHaveBeenCalledWith("real error", 1);
  });
});
