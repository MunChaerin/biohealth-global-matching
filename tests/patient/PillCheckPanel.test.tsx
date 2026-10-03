import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MANUAL_OFFER_MS, PillCheckPanel } from "../../components/patient/PillCheckPanel";
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
    expect(speak).toHaveBeenLastCalledWith("지금은 리리베아캡슐 50mg 1캡슐, 타이레놀정 500mg 1알 드실 시간이에요. 먼저 리리베아캡슐 50mg부터 한 알씩, 카메라에서 20~30cm 떨어뜨려 화면 가운데 네모 안에 비춰 주세요.");
    expect(screen.getByText("먼저 리리베아캡슐 50mg부터 약을 한 알만, 카메라에서 20~30cm 떨어뜨려 화면 가운데 네모 안에 비춰 주세요.")).toBeInTheDocument();

    rerender(panel({ kind: "match", drugCode: tylenol.drugCode, box }, { speak }));
    expect(speak).toHaveBeenLastCalledWith("맞아요! 타이레놀정 500mg이에요. 드신 뒤 [먹었어요]를 눌러 주세요.");
    expect(screen.getByRole("button", { name: "먹었어요" })).toBeInTheDocument();
  });

  it("[먹었어요]를 누르면 그 약을 기록하고 남은 약을 안내한다", async () => {
    const speak = vi.fn();
    const onTaken = vi.fn(async () => true);
    const { rerender } = render(panel({ kind: "match", drugCode: tylenol.drugCode, box }, { speak, onTaken }));
    fireEvent.click(screen.getByRole("button", { name: "먹었어요" }));
    expect(onTaken).toHaveBeenCalledWith(tylenol, "camera");
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

describe("PillCheckPanel 거리 안내", () => {
  it("알약이 너무 크게 보이면 멀리 떼라고, 너무 작으면 가까이 하라고 안내한다", () => {
    const { rerender } = render(panel({ kind: "unsure" }, { distance: "tooClose" }));
    expect(screen.getByText("너무 가까워요. 카메라에서 20~30cm 정도 떼 주세요.")).toBeInTheDocument();
    rerender(panel({ kind: "checking", drugCode: lyribea.drugCode }, { distance: "tooFar" }));
    expect(screen.getByText("조금 더 가까이 비춰 주세요.")).toBeInTheDocument();
    rerender(panel({ kind: "match", drugCode: lyribea.drugCode, box }, { distance: "tooClose" })); // 판정이 나면 판정 안내가 먼저
    expect(screen.getByText(/맞아요! 리리베아캡슐 50mg이에요/)).toBeInTheDocument();
  });

  it("타이레놀만 남으면 '먼저 …부터' 없이 안내한다", () => {
    render(panel({ kind: "noPill" }, { takenIds: [lyribea.id] }));
    expect(screen.getByText("약을 한 알만, 카메라에서 20~30cm 떨어뜨려 화면 가운데 네모 안에 비춰 주세요.")).toBeInTheDocument();
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

describe("PillCheckPanel 모델이 애매할 때 사진으로 확인", () => {
  const image = "data:image/jpeg;base64,AAAA";

  it("각인을 읽는 중이면 그렇게 안내한다", () => {
    render(panel({ kind: "unsure" }, { ask: { kind: "reading" } }));
    expect(screen.getByText("약에 새겨진 글자를 확인하고 있어요…")).toBeInTheDocument();
  });

  it("남은 약이 하나면 그 약이 맞는지 묻고, [맞아요]면 그 약을 넘긴다", () => {
    const onAnswer = vi.fn();
    const speak = vi.fn();
    render(panel({ kind: "unsure" }, { speak, onAnswer, takenIds: [tylenol.id], ask: { kind: "ask", candidates: [lyribea.drugCode], image, confidence: 0.5 } }));
    expect(speak).toHaveBeenLastCalledWith("이 약이 리리베아캡슐 50mg인가요? DWB PGN 50 글자가 보이는지 사진을 보고 알려 주세요.");
    expect(screen.getByAltText("카메라로 본 약")).toHaveAttribute("src", image);
    fireEvent.click(screen.getByRole("button", { name: "아니에요" }));
    expect(onAnswer).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "맞아요" }));
    expect(onAnswer).toHaveBeenLastCalledWith(lyribea.drugCode);
  });

  it("남은 약이 둘이면 각인과 함께 골라 달라고 한다 (모델이 높게 본 약이 앞)", () => {
    const onAnswer = vi.fn();
    render(panel({ kind: "unsure" }, { onAnswer, ask: { kind: "ask", candidates: [tylenol.drugCode, lyribea.drugCode], image, confidence: 0.45 } }));
    expect(screen.getByText("어떤 약인가요? 사진을 보고 골라 주세요.")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons.indexOf("타이레놀정 500mg각인 TYLENOL / 500")).toBeLessThan(buttons.indexOf("리리베아캡슐 50mg각인 DWB PGN 50"));
    fireEvent.click(screen.getByRole("button", { name: /타이레놀정 500mg/ }));
    expect(onAnswer).toHaveBeenLastCalledWith(tylenol.drugCode);
    fireEvent.click(screen.getByRole("button", { name: "둘 다 아니에요" }));
    expect(onAnswer).toHaveBeenLastCalledWith(null);
  });

  it("사진을 보고 고른 약의 [먹었어요]는 confirmed로 기록한다", () => {
    const onTaken = vi.fn(async () => true);
    render(panel({ kind: "match", drugCode: lyribea.drugCode, byPerson: true }, { onTaken }));
    fireEvent.click(screen.getByRole("button", { name: "먹었어요" }));
    expect(onTaken).toHaveBeenCalledWith(lyribea, "confirmed");
  });
});

describe("PillCheckPanel 인식이 안 될 때 직접 기록", () => {
  it("모델을 쓸 수 없으면 카메라 없이 직접 기록할 수 있고, manual로 기록한다", () => {
    const onTaken = vi.fn(async () => true);
    render(panel({ kind: "noPill" }, { phase: "error", onTaken }));
    fireEvent.click(screen.getByRole("button", { name: "카메라 없이 직접 기록하기" }));
    expect(screen.getByText(/의료진에게는 "직접 기록"으로 보여요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "리리베아캡슐 50mg을 먹었어요" }));
    expect(onTaken).toHaveBeenCalledWith(lyribea, "manual");
  });

  it("카메라가 정상이면 처음엔 직접 기록을 보여주지 않고, 한참 알아보지 못하면 보여준다", () => {
    vi.useFakeTimers();
    try {
      render(panel({ kind: "unsure" }));
      expect(screen.queryByRole("button", { name: "카메라 없이 직접 기록하기" })).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(MANUAL_OFFER_MS));
      expect(screen.getByRole("button", { name: "카메라 없이 직접 기록하기" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("맞는 약이 보이면 직접 기록 대신 [먹었어요]만 보여준다", () => {
    render(panel({ kind: "match", drugCode: lyribea.drugCode, box }, { cameraProblem: "카메라를 쓸 수 없어요." }));
    expect(screen.queryByRole("button", { name: "카메라 없이 직접 기록하기" })).not.toBeInTheDocument();
  });
});
