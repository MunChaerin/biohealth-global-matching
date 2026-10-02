import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PillCheckPanel } from "../../components/patient/PillCheckPanel";
import { getMedicationSchedule } from "../../lib/medication/schedule";
import type { PillVerdict } from "../../lib/pill/verdict";

// 아침 08:00: 리리베아캡슐 50mg + 타이레놀정 500mg
const morning = getMedicationSchedule("tanaka-haruko").filter((item) => item.time === "08:00");
const [lyribea, tylenol] = morning as [(typeof morning)[number], (typeof morning)[number]];
const box = [0.4, 0.4, 0.2, 0.1] as const;

function panel(verdict: PillVerdict, extra: Partial<Parameters<typeof PillCheckPanel>[0]> = {}) {
  return (
    <PillCheckPanel
      language="ko"
      group={morning}
      takenIds={[]}
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

describe("PillCheckPanel - 같은 시간에 2알을 한 알씩", () => {
  it("시작 안내에 이번에 먹을 약을 모두 말하고, 어느 약이든 먼저 비추면 맞음", () => {
    const speak = vi.fn();
    const { rerender } = render(panel({ kind: "noPill" }, { speak }));
    expect(speak).toHaveBeenLastCalledWith("지금은 리리베아캡슐 50mg 1캡슐, 타이레놀정 500mg 1알 드실 시간이에요. 한 알씩 카메라 가까이 비춰 주세요.");

    rerender(panel({ kind: "match", drugCode: tylenol.drugCode, box }, { speak }));
    expect(speak).toHaveBeenLastCalledWith("맞아요! 타이레놀정 500mg이에요. 드신 뒤 [먹었어요]를 눌러 주세요.");
    expect(screen.getByRole("button", { name: "먹었어요" })).toBeInTheDocument();
  });

  it("[먹었어요]를 누르면 그 약을 기록하고 남은 약을 안내한다", async () => {
    const speak = vi.fn();
    const onTaken = vi.fn(async () => true);
    const { rerender } = render(panel({ kind: "match", drugCode: tylenol.drugCode, box }, { speak, onTaken }));
    fireEvent.click(screen.getByRole("button", { name: "먹었어요" }));
    expect(onTaken).toHaveBeenCalledWith(tylenol);
    // 부모가 먹은 약을 표시하면
    rerender(panel({ kind: "checking", drugCode: tylenol.drugCode }, { speak, onTaken, takenIds: [tylenol.id] }));
    expect(await screen.findByText("복용을 기록했어요. 이제 리리베아캡슐 50mg(흰색 길쭉한 캡슐 (DWB PGN50))을 비춰 주세요.")).toBeInTheDocument();
    expect(speak).toHaveBeenLastCalledWith("복용을 기록했어요. 이제 리리베아캡슐 50mg(흰색 길쭉한 캡슐 (DWB PGN50))을 비춰 주세요.");
    expect(screen.getByText(/✓ 타이레놀정 500mg/)).toBeInTheDocument();
  });

  it("방금 먹은 약을 다시 비추면 '방금 드셨어요'라고 안내한다", () => {
    render(panel({ kind: "mismatch", drugCode: tylenol.drugCode, box }, { takenIds: [tylenol.id] }));
    expect(screen.getByText(/이 약은 방금 드셨어요. 이제 리리베아캡슐 50mg/)).toBeInTheDocument();
  });

  it("다른 약이면 남은 약을 모두 알려준다", () => {
    render(panel({ kind: "mismatch", drugCode: "K-005849", box }));
    expect(screen.getByText(/이 약은 무스판정이에요. 지금 드실 약이 아니에요. 리리베아캡슐 50mg\(.*\), 타이레놀정 500mg\(흰색 길쭉한 알약\)을 비춰 주세요./)).toBeInTheDocument();
  });

  it("모두 먹으면 끝났다고 안내하고 닫기 버튼만 남긴다", () => {
    const speak = vi.fn();
    render(panel({ kind: "noPill" }, { speak, takenIds: [lyribea.id, tylenol.id] }));
    expect(screen.getByText("이번 약을 모두 드셨어요. 기록했어요.")).toBeInTheDocument();
    expect(speak).toHaveBeenLastCalledWith("이번 약을 모두 드셨어요. 기록했어요.");
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
  });

  it("같은 상태가 이어지면 다시 읽지 않고, 일본어 화면이면 일본어로 읽는다", () => {
    const speak = vi.fn();
    const { rerender } = render(panel({ kind: "match", drugCode: lyribea.drugCode, box }, { speak, language: "ja" }));
    rerender(panel({ kind: "match", drugCode: lyribea.drugCode, box }, { speak, language: "ja" }));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenLastCalledWith(expect.stringContaining("合っています！リリベアカプセル50mgです。"));
  });
});

describe("PillCheckPanel 판단 근거", () => {
  it("카메라로 본 약 확대 사진과 각인을 등록된 약과 나란히 보여준다", () => {
    render(panel({ kind: "mismatch", drugCode: "K-005849", box }, { evidence: { drugCode: "K-005849", image: "data:image/jpeg;base64,AAAA" } }));
    expect(screen.getByAltText("카메라로 본 약")).toHaveAttribute("src", "data:image/jpeg;base64,AAAA");
    expect(screen.getByText("무스판정 · 각인 MSP 500")).toBeInTheDocument();
    expect(screen.getByText("리리베아캡슐 50mg · 각인 DWB PGN 50")).toBeInTheDocument();
    expect(screen.getByText("타이레놀정 500mg · 각인 TYLENOL / 500")).toBeInTheDocument();
  });
});
