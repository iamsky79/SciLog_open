# SciLog

학생 연구 활동을 학년이 바뀌어도 끊기지 않게 기록하고 관리하는 웹 서비스입니다.
R&E, 동아리, 창의개인연구 같은 연구 활동의 계획서, 활동 일지, 보고서, 수상 실적을 한곳에 모으고, 교사가 검토하고 포트폴리오로 내보낼 수 있습니다.

## 주요 기능

- **연구 기록**: R&E 팀, 동아리, 창의개인연구, 기타 활동(대회, 발명, 아이디어 등), 수상 실적
- **제출과 검토**: 계획서, 활동 일지, 보고서 제출 → 담당 교사 검토(승인, 수정 요청)
- **포트폴리오**: 학생별 연구 이력 모아보기, PDF, Word, Excel 내보내기
- **관리자 도구**: 학생, 교사 계정 일괄 생성(엑셀 업로드), 팀 관리, 제출 일정 관리
- **AI 학생 분석** (선택): 교사가 학생의 활동 기록을 바탕으로 요약 분석을 받을 수 있음

역할은 학생, 교사, 관리자 세 가지입니다. 공개 회원가입은 없고, 모든 계정은 관리자가 만듭니다.

## 기술 스택

- [Next.js](https://nextjs.org) (App Router), React, TypeScript, Tailwind CSS
- [Supabase](https://supabase.com) (Postgres, Auth, Storage, Row Level Security)
- [Vercel](https://vercel.com) 배포 권장

## 설치 방법

학교마다 **자기 Supabase 프로젝트와 자기 Vercel 배포**를 따로 만들어 씁니다. 학생 데이터는 각 학교의 Supabase에만 저장됩니다.

### 1. Supabase 프로젝트 만들기

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다. (리전은 Seoul 권장)
2. **Authentication > Sign In / Providers**에서 **"Allow new users to sign up"을 끕니다.**
   계정은 관리자 화면에서만 만들기 때문에 공개 가입은 필요 없고, 켜 두면 누구나 학생 계정을 만들 수 있습니다.

### 2. 데이터베이스 구조 만들기

`supabase/migrations/` 폴더의 SQL 파일을 **번호 순서대로** 적용합니다.

**방법 A. Supabase CLI (권장)**

```bash
npx supabase login
npx supabase link --project-ref <프로젝트-ref>
npx supabase db push
```

`link` 단계에서 설정 파일이 없다는 오류가 나면 먼저 `npx supabase init`을 실행하세요.

**방법 B. SQL Editor**

Supabase 대시보드 > SQL Editor에서 `001_init.sql`부터 마지막 파일까지 하나씩 붙여넣고 실행합니다.

### 3. 첫 관리자 계정 만들기

1. Supabase 대시보드 > **Authentication > Users > Add user**에서 이메일과 비밀번호를 입력하고 **Auto Confirm User**를 체크합니다.
   이메일은 로그인에 쓰이지 않으므로 `admin@scilog.local`처럼 써도 됩니다.
2. [`supabase/setup/first_admin.sql`](supabase/setup/first_admin.sql)을 열어 이메일, 로그인 아이디, 이름을 바꾼 뒤 SQL Editor에서 실행합니다.
3. 앱에서 그 아이디와 비밀번호로 로그인하면 관리자 화면이 보입니다.

이후 교사, 학생 계정은 관리자 화면에서 만듭니다.

### 4. Vercel에 배포하기

1. 이 저장소를 자기 GitHub 계정으로 Fork 하거나 복사합니다.
2. [Vercel](https://vercel.com/new)에서 그 저장소를 Import 합니다.
3. **Environment Variables**에 아래 값을 넣고 Deploy 합니다.

| 이름 | 필수 | 어디서 찾나요 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 필수 | Supabase > Project Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 필수 | Supabase > Project Settings > API (anon / publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수 | Supabase > Project Settings > API (service_role / secret) |
| `ANTHROPIC_API_KEY` | 선택 | [Anthropic Console](https://console.anthropic.com). 비우면 AI 분석 기능만 꺼집니다 |
| `SCHOOL_LABEL` | 선택 | AI 분석에 쓰일 학교 유형. 예: `과학고`, `영재학교` (기본값 `고등학교`) |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY`는 모든 보안 규칙을 우회하는 키입니다. 절대 공개하거나 `NEXT_PUBLIC_` 이름으로 넣지 마세요.

## 로컬에서 실행하기

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

http://localhost:3000 에서 확인할 수 있습니다.

테스트:

```bash
npm run test:security   # 권한 상승 방지 회귀 테스트 (로컬 Postgres로 실행, 실제 DB 접속 안 함)
npm run test:access     # 교사 열람 범위 테스트
```

## 우리 학교에 맞게 바꾸기

| 바꿀 것 | 파일 |
|---|---|
| 교사 과목 목록 | `src/lib/subject-map.ts` |
| 동아리 구분 | `src/lib/club-types.ts` |
| 학번 형식, 아이디 생성 규칙 | `src/lib/account-codes.ts` |
| 학기 구분 | `src/lib/database.types.ts`의 `Semester` |

## 보안 참고

- 모든 테이블에 Row Level Security가 켜져 있습니다. 학생은 자기 기록과 소속 팀 기록만, 교사는 담당 학생 기록을 중심으로 볼 수 있습니다.
- 관리자 기능(계정 생성, 삭제, 비밀번호 초기화 등)은 서버 API에서 관리자 여부를 확인한 뒤에만 실행됩니다.
- 계정을 만들거나 비밀번호를 초기화하면 **무작위 10자리 초기 비밀번호**가 발급됩니다. 학번이나 이름으로 유추할 수 없고, 서버에 따로 저장되지 않아 발급 화면에서 한 번만 볼 수 있습니다. 엑셀 일괄 등록 후에는 **결과 엑셀 다운로드**로 받아 배부하고, 배부가 끝나면 파일을 지우세요.
- 초기 비밀번호로 로그인하면 **새 비밀번호로 바꾸기 전까지 다른 화면을 이용할 수 없습니다.**
- 학생 개인정보를 다루므로 학교의 개인정보 처리 절차(동의, 보관 기간 등)에 맞춰 운영하세요.

보안 문제를 발견하면 공개 이슈 대신 저장소 관리자에게 따로 알려주세요.

## 라이선스

[MIT](LICENSE)
