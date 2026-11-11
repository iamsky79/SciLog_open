export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

// 학번: 학년+반+번호(2자리)
export function buildStudentNumber(grade: number, classNo: number, number: number) {
  return `${grade}${classNo}${pad2(number)}`;
}

export function buildStudentUsername(cohort: number, name: string) {
  return `${cohort}${name}`;
}

export function buildTeacherUsername(name: string) {
  return `t${name}`;
}

// 초기 비밀번호는 학번, 이름, 과목 등에서 유추할 수 없도록 매번 무작위로 만든다.
// 손으로 옮겨 적기 쉽도록 헷갈리는 글자(0/O/o, 1/l/I)는 뺐다.
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const INITIAL_PASSWORD_LENGTH = 10;

export function generateInitialPassword(length = INITIAL_PASSWORD_LENGTH) {
  const n = PASSWORD_ALPHABET.length;
  // 모듈로 편향을 피하려고 n의 배수 범위를 넘는 바이트는 버린다(rejection sampling).
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) out += PASSWORD_ALPHABET[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

// Supabase Auth는 한글이 포함된 이메일을 거부하므로, 사용자에게 보이는
// username과는 별개로 내부적으로만 쓰이는 ASCII 이메일을 둔다.
export function buildStudentEmail(cohort: number, studentNumber: string) {
  return `stu_${cohort}_${studentNumber}@scilog.local`;
}

export function buildTeacherEmail() {
  return `tea_${Date.now()}@scilog.local`;
}
