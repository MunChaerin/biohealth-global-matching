import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 개발용: 시연 기기(아이패드 후면 카메라 등)로 찍은 알약 사진을 학습 데이터로 저장한다 (/pill-capture 화면).
// "사진·프레임은 서버로 보내지 않는다"는 규격의 유일한 예외라서, 개발 서버(next dev)에서만 동작하고
// 배포(production)에서는 CAMERA_DEMO_MODE와 상관없이 항상 막는다. 저장 위치는 레포에 올리지 않는 own_photos/.
const ownPhotos = () => path.join(process.cwd(), "camera-model", "pill-recognition", "own_photos");
const classesJson = () => path.join(process.cwd(), "public", "models", "pill", "classes.json");
const MAX_IMAGE_BYTES = 8_000_000;

function devOnly(): NextResponse | null {
  return process.env.NODE_ENV === "production" ? NextResponse.json({ error: "개발 서버에서만 사용할 수 있습니다." }, { status: 404 }) : null;
}

async function classCodes(): Promise<string[]> {
  const classes = JSON.parse(await readFile(classesJson(), "utf8")) as { code: string }[];
  return classes.map((item) => item.code);
}

async function countPhotos(code: string): Promise<number> {
  try {
    return (await readdir(path.join(ownPhotos(), code))).filter((name) => name.endsWith(".jpg")).length;
  } catch {
    return 0;
  }
}

/** 약별로 지금까지 찍은 장수 */
export async function GET() {
  const blocked = devOnly();
  if (blocked) return blocked;
  const codes = await classCodes();
  const counts = Object.fromEntries(await Promise.all(codes.map(async (code) => [code, await countPhotos(code)] as const)));
  return NextResponse.json({ counts });
}

interface CaptureBody {
  drugCode?: unknown;
  image?: unknown; // data:image/jpeg;base64,...
  box?: unknown; // 프레임 기준 정규화 [x, y, w, h] (지금 모델이 찾은 위치) 또는 null
  model?: unknown; // 찾을 때 모델이 본 약·확신 (참고용)
  camera?: unknown; // "rear" | "front"
  width?: unknown;
  height?: unknown;
}

function isBox(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === "number" && v >= 0 && v <= 1);
}

export async function POST(request: Request) {
  const blocked = devOnly();
  if (blocked) return blocked;

  let body: CaptureBody;
  try {
    body = (await request.json()) as CaptureBody;
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const codes = await classCodes();
  if (typeof body.drugCode !== "string" || !codes.includes(body.drugCode)) {
    return NextResponse.json({ error: "학습하는 10종의 약 코드가 아닙니다." }, { status: 400 });
  }
  const match = typeof body.image === "string" ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
  if (!match) return NextResponse.json({ error: "image는 JPEG data URL이어야 합니다." }, { status: 400 });
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "사진이 너무 큽니다." }, { status: 413 });
  if (body.box !== null && body.box !== undefined && !isBox(body.box)) {
    return NextResponse.json({ error: "box는 0~1 사이 [x, y, w, h] 또는 null이어야 합니다." }, { status: 400 });
  }

  const dir = path.join(ownPhotos(), body.drugCode);
  await mkdir(dir, { recursive: true });
  const now = new Date();
  const stamp = `${now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15)}_${String(now.getMilliseconds()).padStart(3, "0")}`;
  await writeFile(path.join(dir, `${stamp}.jpg`), bytes);
  const meta = {
    drugCode: body.drugCode,
    box: isBox(body.box) ? body.box : null,
    width: typeof body.width === "number" ? body.width : null,
    height: typeof body.height === "number" ? body.height : null,
    source: "web_capture",
    camera: body.camera === "rear" || body.camera === "front" ? body.camera : null,
    model: body.model ?? null,
    capturedAt: now.toISOString(),
  };
  await writeFile(path.join(dir, `${stamp}.json`), JSON.stringify(meta));
  return NextResponse.json({ saved: `${body.drugCode}/${stamp}.jpg`, count: await countPhotos(body.drugCode), box: meta.box });
}
