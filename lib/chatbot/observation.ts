import type { ChatbotContext } from "./types";

export interface ConversationObservation { title: string; trend: string; detail: string; score: number; evidence: string; }

export function createConversationObservation(context: ChatbotContext): ConversationObservation {
  const patientText = context.messages.filter((message) => message.role === "patient").map((message) => message.text).join(" ");
  if (!patientText.trim()) return { title: "대화 관찰을 준비하고 있어요", trend: "기록 대기", detail: "환자 대화가 시작되면 관찰 내용을 표시합니다.", score: 50, evidence: "환자 발화 없음" };
  const concern = context.language === "ja"
    ? /痛い|痛み|つらい|不快|不安|心配|眠れ|疲れ|うつ|寂しい|怖い|嫌|死にたい/.test(patientText)
    : /아프|통증|불편|힘들|불안|걱정|잠|피곤|우울|외롭|무서|싫어|죽고|없어지고/.test(patientText);
  const reassuring = context.language === "ja"
    ? /大丈夫|楽|安心|ありがとう|落ち着|できます/.test(patientText)
    : /괜찮|편안|좋아|고마|안심|괜찮아|할 수/.test(patientText);
  const score = Math.max(10, Math.min(90, 50 + (reassuring ? 18 : 0) - (concern ? 18 : 0)));
  return {
    title: score >= 60 ? "안정적인 표현이 늘고 있어요" : score <= 40 ? "불편감 표현을 확인해 주세요" : "여러 표현이 함께 관찰돼요",
    trend: score >= 60 ? "↗ 안정 표현 증가" : score <= 40 ? "↘ 확인 필요" : "→ 혼재된 표현",
    detail: concern ? "환자가 불편감·걱정과 관련된 표현을 남겼습니다." : "현재 대화에서 뚜렷한 위험 표현은 확인되지 않았습니다.",
    score,
    evidence: patientText.slice(0, 80),
  };
}
