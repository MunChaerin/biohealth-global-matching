import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTodayMedication } from "../../components/patient/useTodayMedication";

const sample = (patient: string) => ({ date: "2026-10-03", items: [{ id: `${patient}-am` }], next: null, nextGroup: [], reminders: [] });

describe("useTodayMedication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("[회귀] 환자가 바뀌면 이전 정보를 바로 지우고, 늦게 도착한 이전 환자의 응답은 버린다", async () => {
    let resolveOld: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      url.includes("patientId=old")
        ? new Promise<Response>((resolve) => (resolveOld = resolve))
        : Promise.resolve(new Response(JSON.stringify(sample("new")))),
    ));
    const { result, rerender } = renderHook(({ id }) => useTodayMedication(id), { initialProps: { id: "old" } });
    rerender({ id: "new" });
    await waitFor(() => expect(result.current.today?.items[0]).toEqual({ id: "new-am" }));
    await act(async () => resolveOld(new Response(JSON.stringify(sample("old")))));
    expect(result.current.today?.items[0]).toEqual({ id: "new-am" });
  });
});
