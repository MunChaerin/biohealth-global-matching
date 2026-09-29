import type { SafetyFlag } from "./types";

const suicidePatterns = ["죽고 싶", "살고 싶지 않", "자해", "목숨을 끊", "죽을까"];
const respiratoryPatterns = ["숨이 너무 차", "숨을 못 쉬", "호흡이 곤란", "가슴이 조여"];
const deliriumPatterns = ["헛것", "누가 보", "여기가 어디", "정신이 혼란", "갑자기 이상"];
const neurologicalPatterns = ["한쪽 팔", "말이 어눌", "입이 돌아", "갑자기 못 걷", "마비"];

function containsPattern(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function detectSafetyFlags(text: string): SafetyFlag[] {
  const normalized = text.trim().toLowerCase();
  const flags: SafetyFlag[] = [];

  if (containsPattern(normalized, suicidePatterns)) {
    flags.push({ type: "suicide", severity: "high", evidence: text });
  }
  if (containsPattern(normalized, respiratoryPatterns)) {
    flags.push({ type: "respiratory", severity: "high", evidence: text });
  }
  if (containsPattern(normalized, deliriumPatterns)) {
    flags.push({ type: "delirium", severity: "high", evidence: text });
  }
  if (containsPattern(normalized, neurologicalPatterns)) {
    flags.push({ type: "neurological", severity: "high", evidence: text });
  }

  return flags;
}
