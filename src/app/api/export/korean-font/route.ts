import { NextResponse } from "next/server";

// PDF 내보내기(jsPDF)는 기본 폰트(helvetica)로 한글을 렌더링하지 못한다(글자가 깨짐).
// 브라우저의 fetch()는 User-Agent 헤더를 덮어쓸 수 없어(forbidden header) 클라이언트에서
// 직접 Google Fonts CSS2 API를 호출하면 항상 woff2가 내려온다(jsPDF는 ttf만 지원).
// 이 라우트가 서버에서 대신 오래된 User-Agent로 요청해 ttf를 받아 그대로 전달한다.
//
// 주의: 처음에는 실제로 쓰이는 글자만 골라 요청하는 동적 서브셋(text= 파라미터)을 시도했으나,
// 렌더링 시점의 텍스트와 서브셋 요청 시점에 모아둔 글자 목록이 100% 일치하지 않으면
// 목록에 없던 글자가 "깨지는" 게 아니라 PDF에서 통째로 사라지는(무음 데이터 손실) 문제를
// 실제로 재현·확인했다. 정확성이 다운로드 용량보다 훨씬 중요하므로,
// 항상 완전한 폰트 파일(모든 한글 음절 포함)을 받아 캐시해 이 문제 자체를 없앤다.
// 폰트 파일 URL은 (family, weight) 조합에 대해 고정이므로 1년 캐시해도 안전하다.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weight = searchParams.get("weight") === "700" ? "700" : "400";

  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent("Noto Sans KR")}:wght@${weight}`;
    const cssResp = await fetch(cssUrl, {
      headers: {
        // 구형 브라우저로 위장해 woff2 대신 ttf 응답을 유도한다.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
      },
    });
    if (!cssResp.ok) {
      return NextResponse.json({ error: "font css fetch failed" }, { status: 502 });
    }
    const css = await cssResp.text();
    const match = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/);
    if (!match) {
      return NextResponse.json({ error: "font url not found" }, { status: 502 });
    }
    const fontResp = await fetch(match[1]);
    if (!fontResp.ok) {
      return NextResponse.json({ error: "font file fetch failed" }, { status: 502 });
    }
    const buf = await fontResp.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "font/ttf",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "font proxy error" }, { status: 500 });
  }
}
