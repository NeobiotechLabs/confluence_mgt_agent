'use strict';
// migrator.js의 콘솔 로그/주석이 옛 "Dify" 워딩을 더 이상 노출하지 않는지 정적 검증.
// 정책: 분류 체인은 rule → inline-llm(Anthropic SDK) → fallback 단일 흐름(Dify 미사용).
// 작업 4(워크플로우 YAML 재편) 검증을 위한 회귀 가드.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'scripts', 'migrator.js'),
  'utf8',
);

// 코드 영역만 검증(파일 헤더/COMMENT의 "Dify" 단어 잔재는 정책적으로 의도할 수 있으므로
// console.log / 주석에서 사용자가 보는 메시지를 차단하는 것이 목적).
// 단, source 전체에 "Dify"가 한 번이라도 남아 있으면 사용자 가시 영역에 노출될 수 있다.
// → 우선은 console.log 주위에 한정한 strict 어설션으로 시작.
test('migrator.js: console.log 메시지에 "Dify" 문구가 더 이상 없다', () => {
  // console.log(`...`) … 여러 줄에 걸쳐 있을 수 있으므로 모든 console.log 인자를 추출.
  const logCalls = [...SOURCE.matchAll(/console\.log\(([^)]*)\)/g)].map((m) => m[1]);
  // 백틱/따옴표로 감싸진 첫 번째 토큰을 추출.
  const offenders = logCalls.filter((arg) => /Dify/i.test(arg));
  assert.deepStrictEqual(
    offenders,
    [],
    `console.log 인자에 Dify 잔재 발견: ${offenders.join(' | ')}`,
  );
});

test('migrator.js: 소스 코드 주석에 "Dify-like" 표현이 더 이상 없다', () => {
  // 정확히 "Dify-like" 옛 호환 브릿지 주석을 차단 (정책 변경됨).
  const offenders = [...SOURCE.matchAll(/\bDify-?like\b/gi)].map((m) => m[0]);
  assert.deepStrictEqual(
    offenders,
    [],
    `주석에 Dify-like 잔재 발견: ${offenders.join(' | ')}`,
  );
});
