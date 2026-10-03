import { medicationSchedules } from "../medication/schedule";

// 약 코드 -> 화면에 보여줄 이름. 복약 일정에 있는 약 + 모델이 구분하는 나머지 약.
// 모델이 학습하는 10종 = 시연 2종(일정에 있음) + 아래 8종. 순서는 camera-model/pill-recognition/classes.json.
// 8종은 다운로드 양을 줄이려고 시연 약이 든 이미지 zip(TS_3, VS_10) 안에서 골랐다.
// 색·모양이 다른 약 6종 + 시연 약과 비슷한 흰 약 2종(무스판정 ≈ 타이레놀, 독립목클린캡슐 ≈ 리리베아)을 섞어
// 모델이 색만 보고 외우지 않고 모양·각인까지 보고 구분하도록 했다.
const extraPills: Record<string, { name: string; japaneseName: string; imprint: string }> = {
  "K-044732": { name: "레드리버연질캡슐", japaneseName: "レッドリバー軟カプセル", imprint: "JHRL" },
  "K-004268": { name: "듀오락스정", japaneseName: "デュオラックス錠", imprint: "YI / 24" },
  "K-003727": { name: "퍼킨정", japaneseName: "パーキン錠", imprint: "C L" },
  "K-005676": { name: "복합파자임이중정", japaneseName: "複合パザイム二層錠", imprint: "PΛZ" },
  "K-003746": { name: "토파제정", japaneseName: "トパゼ錠", imprint: "MKTF" },
  "K-005466": { name: "베스자임정", japaneseName: "ベスザイム錠", imprint: "BSZT" },
  "K-005849": { name: "무스판정", japaneseName: "ムスパン錠", imprint: "MSP 500" },
  "K-045269": { name: "독립목클린캡슐", japaneseName: "ドクリプモッククリンカプセル", imprint: "DLB ACC" },
};

/** 마지막 글자에 받침이 있으면 withFinal, 없으면 withoutFinal을 붙인다. 예: 받침(약, "이에요", "예요") */
export function withParticle(word: string, withFinal: string, withoutFinal: string): string {
  const trimmed = word.trim();
  const last = trimmed[trimmed.length - 1] ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  let hasFinal: boolean;
  if (code >= 0 && code <= 11171) hasFinal = code % 28 !== 0;
  else if (/mg$/i.test(trimmed)) hasFinal = true; // 밀리그램
  else if (/\d$/.test(trimmed)) hasFinal = "0136780".includes(last); // 영·일·삼·육·칠·팔 (2·4·5·9는 받침 없음)
  else hasFinal = false;
  return `${word}${hasFinal ? withFinal : withoutFinal}`;
}

export function pillName(drugCode: string, language: "ko" | "ja"): string {
  const extra = extraPills[drugCode];
  if (extra) return language === "ja" ? extra.japaneseName : extra.name;
  for (const items of Object.values(medicationSchedules)) {
    const item = items.find((candidate) => candidate.drugCode === drugCode);
    if (item) return language === "ja" ? item.japaneseName : item.name;
  }
  return language === "ja" ? "別のお薬" : "다른 약";
}

/** 약에 새겨진 각인 (확인 화면에서 사람이 대조하는 근거). 모르면 null. */
export function pillImprint(drugCode: string): string | null {
  const extra = extraPills[drugCode];
  if (extra) return extra.imprint;
  for (const items of Object.values(medicationSchedules)) {
    const item = items.find((candidate) => candidate.drugCode === drugCode);
    if (item?.imprint) return item.imprint;
  }
  return null;
}
