'use strict';
// migrator의 멱등성 분기(동명 페이지 조회) 단위 테스트.
// deps.confluenceRequest 주입으로 네트워크 없이 밀폐 검증한다.
const test = require('node:test');
const assert = require('node:assert');

const { findPageByTitleInAA, cqlEscape } = require('../../scripts/migrator');

test('cqlEscape: 큰따옴표와 백슬래시를 이스케이프, 나머지는 보존', () => {
  assert.strictEqual(cqlEscape('Daily Scrum'), 'Daily Scrum');
  assert.strictEqual(cqlEscape(`AI - '26 7월 월간 MPS`), `AI - '26 7월 월간 MPS`); // 작은따옴표 무해
  assert.strictEqual(cqlEscape('He said "hi"'), 'He said \\"hi\\"');
  assert.strictEqual(cqlEscape('back\\slash'), 'back\\\\slash');
});

test('findPageByTitleInAA: current + 정확 매칭 1건만 반환', async () => {
  const calls = [];
  const fakeReq = async (method, url) => {
    calls.push({ method, url });
    return {
      results: [
        { id: '111', title: 'Daily Scrum', status: 'current' },
        { id: '222', title: 'Daily Scrum', status: 'draft' },       // draft 제외
        { id: '333', title: 'Daily Scrum ', status: 'current' },    // 근사 매칭 제외(정확 매칭 원칙)
      ],
    };
  };
  const hit = await findPageByTitleInAA('Daily Scrum', { confluenceRequest: fakeReq });
  assert.ok(hit);
  assert.strictEqual(hit.id, '111');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'GET');
  // CQL이 AA 스페이스·page 타입·제목 조건을 포함하고 URL 인코딩돼야 한다.
  const decoded = decodeURIComponent(calls[0].url);
  assert.ok(decoded.includes('space="AA"'), `CQL에 스페이스 조건 필요: ${decoded}`);
  assert.ok(decoded.includes('type="page"'), `CQL에 타입 조건 필요: ${decoded}`);
  assert.ok(decoded.includes('title="Daily Scrum"'), `CQL에 제목 조건 필요: ${decoded}`);
});

test('findPageByTitleInAA: 제목에 큰따옴표가 있어도 CQL이 깨지지 않는다', async () => {
  let capturedUrl = '';
  const fakeReq = async (_method, url) => {
    capturedUrl = url;
    return { results: [] };
  };
  await findPageByTitleInAA('He said "hi"', { confluenceRequest: fakeReq });
  const decoded = decodeURIComponent(capturedUrl);
  assert.ok(decoded.includes('title="He said \\"hi\\""'), `이스케이프된 제목 조건 필요: ${decoded}`);
});

test('findPageByTitleInAA: 결과 없으면 null', async () => {
  const fakeReq = async () => ({ results: [] });
  assert.strictEqual(await findPageByTitleInAA('없는 페이지', { confluenceRequest: fakeReq }), null);
});

test('findPageByTitleInAA: results 필드 자체가 없어도 null (응답 형태 방어)', async () => {
  const fakeReq = async () => ({});
  assert.strictEqual(await findPageByTitleInAA('x', { confluenceRequest: fakeReq }), null);
});

test('findPageByTitleInAA: 조회 실패 시 throw하지 않고 null → create 폴백 허용', async () => {
  const fakeReq = async () => { throw new Error('boom 500'); };
  assert.strictEqual(await findPageByTitleInAA('x', { confluenceRequest: fakeReq }), null);
});

test('findPageByTitleInAA: 동명 다건(비정상)이어도 첫 current 매칭 반환', async () => {
  const fakeReq = async () => ({
    results: [
      { id: '1', title: 'dup', status: 'current' },
      { id: '2', title: 'dup', status: 'current' },
    ],
  });
  const hit = await findPageByTitleInAA('dup', { confluenceRequest: fakeReq });
  assert.strictEqual(hit.id, '1');
});
