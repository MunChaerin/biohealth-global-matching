import { NextRequest, NextResponse } from "next/server";

function unauthorized(): NextResponse {
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="CareLink Demo", charset="UTF-8"' },
  });
}

function credentials(request: NextRequest): { username: string; password: string } | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest): NextResponse {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const expectedUsername = process.env.DEMO_ACCESS_USERNAME;
  const expectedPassword = process.env.DEMO_ACCESS_PASSWORD;
  if (!expectedUsername || !expectedPassword) {
    return new NextResponse("배포 접근 보호 설정이 필요합니다.", { status: 503 });
  }

  const provided = credentials(request);
  if (provided?.username !== expectedUsername || provided.password !== expectedPassword) return unauthorized();
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
