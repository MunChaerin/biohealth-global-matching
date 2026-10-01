import { medicationSchedules } from "../medication/schedule";

// 약 코드 -> 화면에 보여줄 이름. 복약 일정에 있는 약 + 모델이 구분하는 나머지 약.
// 모델이 학습하는 10종 = 시연 2종(일정에 있음) + 아래 8종. 순서는 camera-model/pill-recognition/classes.json.
// 8종은 시연 약과 색·모양이 다른 약 위주에, 비슷한 흰 약 2종(부루펜, 마그밀)을 섞어
// 모델이 색만 보고 외우지 않고 모양·각인까지 보고 구분하도록 했다.
const extraPills: Record<string, { name: string; japaneseName: string }> = {
  "K-011354": { name: "애드빌정", japaneseName: "アドビル錠" },
  "K-000112": { name: "아로나민골드", japaneseName: "アロナミンゴールド" },
  "K-026632": { name: "둘코락스에스장용정", japaneseName: "ダルコラックスS腸溶錠" },
  "K-012769": { name: "닥터베아제정", japaneseName: "ドクターベアゼ錠" },
  "K-007024": { name: "훼스탈플러스정", japaneseName: "フェスタルプラス錠" },
  "K-014249": { name: "이지엔6애니연질캡슐", japaneseName: "イージーエン6エニー軟カプセル" },
  "K-001029": { name: "부루펜정 400mg", japaneseName: "ブルフェン錠400mg" },
  "K-000250": { name: "마그밀정 500mg", japaneseName: "マグミル錠500mg" },
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
