import { medicationSchedules } from "../medication/schedule";

// 약 코드 -> 화면에 보여줄 이름. 복약 일정에 있는 약 + 모델이 구분하는 나머지 약(학습 10종 중 일정에 없는 7종).
// 나머지 약은 학습할 10종이 정해지면 추가한다.
const extraPills: Record<string, { name: string; japaneseName: string }> = {};

/** 마지막 글자에 받침이 있으면 withFinal, 없으면 withoutFinal을 붙인다. 예: 받침(약, "이에요", "예요") */
export function withParticle(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
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
