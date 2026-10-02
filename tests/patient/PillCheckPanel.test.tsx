import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PillCheckPanel } from "../../components/patient/PillCheckPanel";
import { getMedicationSchedule } from "../../lib/medication/schedule";
import type { PillVerdict } from "../../lib/pill/verdict";

const medication = getMedicationSchedule("tanaka-haruko")[0]!; // 리리베아캡슐 50mg (각인 DWB PGN 50)
const box = [0.4, 0.4, 0.2, 0.1] as const;

function panel(verdict: PillVerdict, extra: Partial<Parameters<typeof PillCheckPanel>[0]> = {}) {
  return (
    <PillCheckPanel
      language="ko"
      medication={medication}
      phase="running"
      verdict={verdict}
      cameraProblem={null}
      needsCameraConsent={false}
      onAllowCamera={vi.fn()}
      onTaken={vi.fn(async () => true)}
      onClose={vi.fn()}
      {...extra}
    />
  );
}

describe("PillCheckPanel 음성 안내", () => {
  it("시작 안내는 한 번만, 맞음·다름은 바뀔 때마다 읽고 같은 상태는 반복하지 않는다", () => {
    const speak = vi.fn();
    const { rerender } = render(panel({ kind: "noPill" }, { speak }));
    expect(speak).toHaveBeenLastCalledWith("지금은 리리베아캡슐 50mg 1캡슐 드실 시간이에요. 약을 한 알만 카메라 가까이 비춰 주세요.");

    rerender(panel({ kind: "checking", drugCode: "K-004378" }, { speak }));
    rerender(panel({ kind: "mismatch", drugCode: "K-004378", box }, { speak }));
    expect(speak).toHaveBeenLastCalledWith(expect.stringContaining("이 약은 타이레놀정 500mg이에요. 지금 드실 약이 아니에요."));
    rerender(panel({ kind: "mismatch", drugCode: "K-004378", box }, { speak })); // 같은 상태 - 다시 안 읽음

    rerender(panel({ kind: "noPill" }, { speak })); // 약을 내려놓음 - 시작 안내는 다시 안 읽음
    rerender(panel({ kind: "match", drugCode: medication.drugCode, box }, { speak }));
    expect(speak).toHaveBeenLastCalledWith("맞아요! 리리베아캡슐 50mg이에요. 드신 뒤 [먹었어요]를 눌러 주세요.");
    expect(speak).toHaveBeenCalledTimes(3);
  });

  it("일본어 화면이면 일본어로 읽는다", () => {
    const speak = vi.fn();
    render(panel({ kind: "match", drugCode: medication.drugCode, box }, { speak, language: "ja" }));
    expect(speak).toHaveBeenLastCalledWith(expect.stringContaining("合っています！リリベアカプセル50mgです。"));
  });
});

describe("PillCheckPanel 판단 근거", () => {
  it("다른 약이면 카메라로 본 약 확대 사진과 각인을 등록된 약과 나란히 보여준다", () => {
    render(
      panel(
        { kind: "mismatch", drugCode: "K-005849", box },
        { evidence: { drugCode: "K-005849", image: "data:image/jpeg;base64,AAAA" } },
      ),
    );
    expect(screen.getByAltText("카메라로 본 약")).toHaveAttribute("src", "data:image/jpeg;base64,AAAA");
    expect(screen.getByText("무스판정 · 각인 MSP 500")).toBeInTheDocument();
    expect(screen.getByText("리리베아캡슐 50mg · 각인 DWB PGN 50")).toBeInTheDocument();
  });

  it("확대 사진이 다른 약 것이면 보여주지 않는다", () => {
    render(panel({ kind: "match", drugCode: medication.drugCode, box }, { evidence: { drugCode: "K-005849", image: "x" } }));
    expect(screen.queryByAltText("카메라로 본 약")).not.toBeInTheDocument();
  });
});
