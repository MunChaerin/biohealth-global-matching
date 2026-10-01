// 환자별 복약 일정 (데모용). DB가 생기면 여기 대신 DB에서 읽는다.
//
// drugCode는 알약 인식 모델의 클래스와 맞추는 약 코드(AI Hub 경구약제 데이터의 품목기준코드)다.
// 시연에 쓸 실제 알약 3종이 정해지기 전이라 지금은 "pending:약이름" 임시 코드이고,
// 외형 설명도 대표적인 제품 기준 예시라서, 시연 약이 확정되면 코드·외형을 실제 약에 맞춰 바꿔야 한다.

export interface MedicationItem {
  id: string;
  drugCode: string;
  name: string;
  japaneseName: string;
  appearance: string;
  japaneseAppearance: string;
  dose: string;
  japaneseDose: string;
  time: string; // "HH:MM" (하루 복용 시각)
}

export const medicationSchedules: Record<string, MedicationItem[]> = {
  "tanaka-haruko": [
    { id: "tanaka-amlodipine-am", drugCode: "pending:amlodipine", name: "암로디핀", japaneseName: "アムロジピン", appearance: "흰색 팔각형 알약", japaneseAppearance: "白い八角形の錠剤", dose: "1알", japaneseDose: "1錠", time: "08:00" },
    { id: "tanaka-metformin-am", drugCode: "pending:metformin", name: "메트포르민", japaneseName: "メトホルミン", appearance: "흰색 긴 타원형 알약", japaneseAppearance: "白い長円形の錠剤", dose: "1알", japaneseDose: "1錠", time: "08:00" },
    { id: "tanaka-clopidogrel-am", drugCode: "pending:clopidogrel", name: "클로피도그렐", japaneseName: "クロピドグレル", appearance: "분홍색 둥근 알약", japaneseAppearance: "ピンクの丸い錠剤", dose: "1알", japaneseDose: "1錠", time: "08:00" },
    { id: "tanaka-metformin-pm", drugCode: "pending:metformin", name: "메트포르민", japaneseName: "メトホルミン", appearance: "흰색 긴 타원형 알약", japaneseAppearance: "白い長円形の錠剤", dose: "1알", japaneseDose: "1錠", time: "18:00" },
  ],
  "kim-sunja": [
    { id: "kim-acetaminophen-am", drugCode: "pending:acetaminophen", name: "아세트아미노펜", japaneseName: "アセトアミノフェン", appearance: "흰색 긴 알약", japaneseAppearance: "白い長い錠剤", dose: "1알", japaneseDose: "1錠", time: "08:00" },
    { id: "kim-acetaminophen-pm", drugCode: "pending:acetaminophen", name: "아세트아미노펜", japaneseName: "アセトアミノフェン", appearance: "흰색 긴 알약", japaneseAppearance: "白い長い錠剤", dose: "1알", japaneseDose: "1錠", time: "18:00" },
    { id: "kim-zolpidem-night", drugCode: "pending:zolpidem", name: "졸피뎀", japaneseName: "ゾルピデム", appearance: "흰색 길쭉한 알약", japaneseAppearance: "白い細長い錠剤", dose: "1알", japaneseDose: "1錠", time: "21:00" },
  ],
  "sato-kenji": [
    { id: "sato-levodopa-am", drugCode: "pending:levodopa-carbidopa", name: "레보도파·카비도파", japaneseName: "レボドパ・カルビドパ", appearance: "노란색 타원형 알약", japaneseAppearance: "黄色い楕円形の錠剤", dose: "1알", japaneseDose: "1錠", time: "08:00" },
    { id: "sato-theophylline-am", drugCode: "pending:theophylline", name: "테오필린", japaneseName: "テオフィリン", appearance: "흰색 둥근 알약", japaneseAppearance: "白い丸い錠剤", dose: "1알", japaneseDose: "1錠", time: "08:00" },
    { id: "sato-levodopa-pm", drugCode: "pending:levodopa-carbidopa", name: "레보도파·카비도파", japaneseName: "レボドパ・カルビドパ", appearance: "노란색 타원형 알약", japaneseAppearance: "黄色い楕円形の錠剤", dose: "1알", japaneseDose: "1錠", time: "14:00" },
    { id: "sato-magnesium-pm", drugCode: "pending:magnesium-oxide", name: "산화마그네슘", japaneseName: "酸化マグネシウム", appearance: "흰색 작은 둥근 알약", japaneseAppearance: "白い小さな丸い錠剤", dose: "1알", japaneseDose: "1錠", time: "20:00" },
  ],
};

export function getMedicationSchedule(patientId: string): MedicationItem[] {
  return [...(medicationSchedules[patientId] ?? [])].sort((a, b) => a.time.localeCompare(b.time));
}

export function findMedication(patientId: string, medicationId: string): MedicationItem | undefined {
  return medicationSchedules[patientId]?.find((item) => item.id === medicationId);
}
