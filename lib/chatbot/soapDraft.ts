import type { ChatbotContext, SubjectiveData } from "./types";

export function getChatSessionId(personaId: string): string {
  return `demo-${personaId}`;
}

export interface SoapDraft {
  subjective: string;
  subjectiveMeta: string;
  objective: string;
  objectiveMeta: string;
  assessment: string;
  assessmentMeta: string;
  plan: string;
  planMeta: string;
  updatedAt: string;
}

function value(data: SubjectiveData, key: keyof SubjectiveData, label: string): string | null {
  const raw = data[key];
  if (raw === undefined || raw === "unknown" || raw === "") return null;
  return `${label} ${String(raw)}`;
}

export function createSoapDraft(context: ChatbotContext): SoapDraft {
  const subjectiveItems = [
    value(context.subjective, "chiefConcern", "주호소:"),
    value(context.subjective, "location", "부위:"),
    value(context.subjective, "severityNrs", "불편감:"),
    value(context.subjective, "onset", "발생 시점:"),
    value(context.subjective, "functionalImpact", "일상생활 영향:"),
    value(context.subjective, "sleep", "수면:"),
    value(context.subjective, "mood", "기분:"),
  ].filter(Boolean) as string[];

  const subjective = subjectiveItems.length > 0
    ? subjectiveItems.join(" · ")
    : "환자 대화 정보가 아직 수집되지 않았습니다.";
  const messageCount = context.messages.filter((message) => message.role === "patient").length;
  const objective = "현재 실제 카메라·센서·모션 값은 아직 연결되지 않았습니다. S 정보 중심의 초안으로 검토하세요.";
  const severity = context.subjective.severityNrs;
  const assessment = context.safetyFlags.length > 0
    ? "안전 위험 신호가 감지되어 일반 대화보다 즉시 안전 대응과 의료진 확인이 우선입니다."
    : severity !== undefined && severity !== "unknown" && Number(severity) >= 7
      ? "높은 불편감이 보고되어 증상 변화와 안전 신호를 우선 확인해야 합니다."
      : "수집된 주관적 정보를 바탕으로 경과를 관찰하고 의료진 확인이 필요합니다.";
  const plan = context.safetyFlags.length > 0
    ? "안전 대응 경로를 유지하고 의료진이 환자 상태를 직접 확인합니다."
    : "의료진이 S/O 정보를 검토한 뒤 필요한 추가 질문과 관찰 계획을 확정합니다.";

  return {
    subjective,
    subjectiveMeta: `대화 ${messageCount}회 · 상태 ${context.state}`,
    objective,
    objectiveMeta: "O 데이터 소스 연동 대기",
    assessment,
    assessmentMeta: context.safetyFlags.length > 0 ? "안전 대응 우선" : "참고 제안 · 의료진 확인 필요",
    plan,
    planMeta: "의료진 최종 확정",
    updatedAt: new Date().toISOString(),
  };
}
