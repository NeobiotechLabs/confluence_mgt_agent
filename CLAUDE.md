# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 저장소 개요

- **저장소명**: `confluence_mgt_agent`
- **원격**: `git@github.com:NeobiotechLabs/confluence_mgt_agent.git`
- **목적**: 사내 Confluence 스페이스 자동화 관리 + MPS 워크플로우 지원 에이전트

## 현재 프로젝트 상태

기존 SD 스페이스(Digital R&D Center) 분석 완료, 신규 스페이스(AA) 설계 및 자동화 구축 예정.

상세 분석: `reference/SD_space_analysis.md`
프로젝트 할일: `reference/ToDo.md`

## Confluence API

- **인스턴스**: `https://neobiotech.atlassian.net`
- **API 버전**: v2 (최신) 권장, v1 (레거시) 보조
- **인증**: 이메일 + API 토큰 (Basic Auth)
- **스페이스**: SD (Digital R&D Center), AA (덴탈AI연구소 Archive)
- **중요**: v1 API는 폴더를 ancestors에 포함하지 않음. 폴더 구조 파악 시 v2 API 필수.
- **rate limit**: Confluence Cloud 기본 5000 req/h

## 아키텍처

- **Confluence API 클라이언트**: REST API v1/v2 호출 래퍼
- **도구(Tools) 계층**: `create_page`, `update_page`, `search_content`, `manage_labels`, `manage_space` 등
- **에이전트 런타임**: 사내 Dify 시스템 기반 LLM 워크플로우
- **설정**: `.env`로 Confluence URL, 사용자명/API 토큰 관리 (커밋 금지)

## 개발 명령어

| 목적 | 명령어 |
|------|--------|
| 의존성 설치 | `npm install` |
| 스페이스 분석 | `node scripts/analyze_sd.js` |
| 테스트 | `npm test` |

## 작업 시 주의사항

- API 토큰, LLM API 키 등 비밀 정보는 절대 커밋하지 말 것 (`.env` 사용)
- 대량 페이지 작업 시 rate limit 고려
- SD 스페이스는 페이지(661개) + 폴더(75개) 혼용 구조
- 폴더끼리 최대 3단계 중첩 가능
