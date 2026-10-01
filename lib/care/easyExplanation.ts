import type { PatientPersona } from "../patient/personas";
import type { SoapDraft } from "../chatbot/soapDraft";

function subjectForPatient(persona: PatientPersona, soap: SoapDraft) {
  if (soap.subjective.startsWith("환자 대화 정보가 아직")) return persona.symptoms;
  return soap.subjective
    .replaceAll("주호소:", "")
    .replaceAll("부위:", "")
    .replaceAll("불편감:", "")
    .split(" · ")
    .slice(0, 2)
    .join(", ");
}

export function createEasyExplanation(persona: PatientPersona, soap: SoapDraft): string {
  const subject = subjectForPatient(persona, soap);
  const safetyFirst = soap.assessment.includes("안전 위험") || soap.assessment.includes("높은 불편감");

  if (safetyFirst) {
    return `${persona.name} 어르신, ${subject} 상태를 확인했어요. 지금은 안전을 먼저 살펴볼게요. 혼자 무리하지 말고, 불편하거나 걱정되는 점이 있으면 바로 알려주세요.`;
  }

  return `${persona.name} 어르신, 오늘 말씀해주신 ${subject} 상태를 의료진이 확인하고 있어요. 무리하지 말고 편하게 쉬어주세요. 상태가 달라지거나 불편한 점이 생기면 알려주세요.`;
}
