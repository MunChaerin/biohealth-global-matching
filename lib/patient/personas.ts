export interface PatientPersona {
  id: string;
  name: string;
  japaneseName: string;
  age: number;
  room: string;
  summary: string;
  diagnosis: string;
  symptoms: string;
  medications: string;
  greeting: string;
  japaneseGreeting: string;
  quickReplies: string[];
  japaneseQuickReplies: string[];
}

export const patientPersonas: PatientPersona[] = [
  {
    id: "tanaka-haruko",
    name: "다나카 하루코",
    japaneseName: "田中はる子",
    age: 82,
    room: "햇살관 203호",
    summary: "뇌경색 후 우측 편마비와 우측 하지 저림을 관찰 중인 환자",
    diagnosis: "뇌경색 좌측 MCA 영역 · 우측 편마비 · 제2형 당뇨 · MCI 의심",
    symptoms: "우측 하지 저림, 수면 저하, 경도 실어증",
    medications: "암로디핀 · 메트포르민 · 클로피도그렐",
    greeting: "오늘 오른쪽 다리와 몸 상태는 어떠세요?",
    japaneseGreeting: "今日、右足や体の具合はいかがですか？",
    quickReplies: ["오른쪽 다리가 저릿해요", "잠을 잘 못 잤어요", "괜찮은 편이에요"],
    japaneseQuickReplies: ["右足がしびれます", "よく眠れませんでした", "大丈夫です"],
  },
  {
    id: "kim-sunja",
    name: "김순자",
    japaneseName: "キム・スンジャ",
    age: 79,
    room: "햇살관 108호",
    summary: "우측 고관절 수술 후 재활 중인 환자",
    diagnosis: "우측 대퇴골 경부골절 수술 후 · 낙상공포 · 골다공증 · 우울 위험",
    symptoms: "수술 부위 통증, 이동 불안, 불면, 의욕 저하",
    medications: "알렌드로네이트 · 아세트아미노펜 · 졸피뎀",
    greeting: "오늘 몸을 움직일 때 불편한 점이 있었나요?",
    japaneseGreeting: "今日は体を動かすとき、つらいことがありましたか？",
    quickReplies: ["엉덩이가 아파요", "넘어질까 봐 무서워요", "기운이 없어요"],
    japaneseQuickReplies: ["股関節が痛いです", "転ぶのが怖いです", "元気が出ません"],
  },
  {
    id: "sato-kenji",
    name: "사토 켄지",
    japaneseName: "佐藤健二",
    age: 76,
    room: "햇살관 315호",
    summary: "파킨슨병과 COPD를 함께 관찰 중인 환자",
    diagnosis: "파킨슨병 Hoehn-Yahr 3단계 · COPD GOLD 2 · 연하곤란 경향",
    symptoms: "안정시 떨림, 느린 움직임, 활동 시 호흡곤란, 기침",
    medications: "레보도파·카비도파 · 테오필린 · 산화마그네슘",
    greeting: "오늘 움직임과 호흡은 평소와 어떤가요?",
    japaneseGreeting: "今日の動きや呼吸は、いつもと比べていかがですか？",
    quickReplies: ["손이 떨려요", "숨이 조금 차요", "움직임이 느려졌어요"],
    japaneseQuickReplies: ["手が震えます", "少し息苦しいです", "動きが遅くなりました"],
  },
];

export const defaultPersona = patientPersonas[0]!;

export function getPatientPersona(id?: string | null): PatientPersona {
  return patientPersonas.find((persona) => persona.id === id) ?? defaultPersona;
}
