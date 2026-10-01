// 환자별 복약 일정 (데모용). DB가 생기면 여기 대신 DB에서 읽는다.
//
// drugCode는 알약 인식 모델의 클래스와 맞추는 약 코드(AI Hub 경구약제 데이터의 K-코드)다.
// 시연 환자(다나카 하루코)는 실제 시연 알약 2종(리리베아캡슐 50mg, 타이레놀정 500mg)으로 되어 있고,
// 모델이 학습하는 10종 목록은 camera-model/pill-recognition/classes.json이다.
// 다른 두 환자의 약은 모델이 학습하지 않은 약이라 "pending:약이름" 임시 코드 (알약 확인 시연에는 쓰지 않음).

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
  // 시연 환자: 우측 하지 저림(신경병증성 통증) -> 아침 프레가발린, 저녁 아세트아미노펜
  "tanaka-haruko": [
    { id: "tanaka-lyribea-am", drugCode: "K-045037", name: "리리베아캡슐 50mg", japaneseName: "リリベアカプセル50mg", appearance: "흰색 길쭉한 캡슐 (DWB PGN50)", japaneseAppearance: "白い長いカプセル（DWB PGN50）", dose: "1캡슐", japaneseDose: "1カプセル", time: "08:00" },
    { id: "tanaka-tylenol-pm", drugCode: "K-004378", name: "타이레놀정 500mg", japaneseName: "タイレノール錠500mg", appearance: "흰색 길쭉한 알약", japaneseAppearance: "白い長い錠剤", dose: "1알", japaneseDose: "1錠", time: "18:00" },
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
