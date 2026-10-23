# Formwheel_GCrown

보드 위에서 왕관을 차지하기 위해 경쟁하는 전략 게임.

- 실행: https://semicolonxss.github.io/Formwheel_GCrown/
- 프로젝트 목록: https://semicolonxss.github.io/Formwheel/
- 진행 상태: https://semicolonxss.github.io/Formwheel_Check/

## 사용

브라우저에서 실행 링크를 여세요. 화면에 표시된 설명과 버튼으로 진행합니다. 온라인 기능은 Firebase 연결이 필요하며, 방 게임은 같은 코드로 참가합니다. 로컬 저장은 현재 브라우저에만 남습니다.

## 2026-10-08 개선

왕관 보유자가 나간 경우와 전원이 나간 결과의 무승부 표시를 보완했습니다. 보드 크기 5/6/7, 마지막 행동, 왕관 점수, 방어막·탈취·공동 승리 회귀 테스트를 제공합니다.

## 개발 및 검증

정적 HTML/JavaScript 프로젝트입니다. HTTP 서버로 제공하세요. Firebase 운영 설정·Rules는 이 저장소의 화면 파일만 배포해서 바뀌지 않습니다.

```sh
node scripts/check-syntax.cjs
node tests/regression.test.cjs
```

첫 검사는 JavaScript 구문과 상대경로 파일 존재를 확인합니다. 모든 앱의 실제 멀티플레이와 운영 권한을 보증하는 검사는 아닙니다.

## 데이터 및 운영 보안

공통 안내: https://semicolonxss.github.io/Formwheel/privacy.html

닉네임·답안·점수·채팅 등이 서버에 저장될 수 있습니다. 새 보안 스키마와 서버 코드는 [Formwheel/firebase-security](https://github.com/SemicolonXSS/Formwheel/tree/main/firebase-security)에 준비했습니다. 현재 운영 적용 및 기존 경로 전환이 완료되었다고 가정하지 마세요. 계정/제공자 설정, 서버 보안 검증이 필요한 항목은 Check에서 별도로 남겨둡니다.

화면 마크업은 `index.html`, 앱별 스타일과 실행 코드는 `assets/`에 분리했습니다. 공통 UI는 Formwheel 저장소의 `shared/`를 사용합니다.

## 🎮 게임 가이드

**왕관 점령 보드게임** — 왕관을 차지한 상태로 턴을 마치면 점수를 얻는 2~4인 보드게임입니다.

### 플레이 방법

1. 솔로 AI 또는 멀티플레이 선택
2. 주사위/이동 규칙에 따라 1칸 이동
3. 왕관을 점령·방어·탈취
4. 30턴 뒤 점수 비교

### 주요 기능

- 왕관 점령 턴당 점수
- 특수칸
- AI 난이도
- 멀티플레이

> 구체적인 지원 모드와 버튼 이름은 배포 버전에 따라 달라질 수 있습니다.

<!-- FORMWHEEL-README-2026 -->
## 🎡 Formwheel 프로젝트 안내

**Formwheel GCrown**은(는) Formwheel 플랫폼의 전략 보드게임 프로젝트입니다.

- **[프로젝트 실행하기](https://semicolonxss.github.io/Formwheel_GCrown/)** · **[Formwheel Hub](https://semicolonxss.github.io/Formwheel/)**
- **[개발 현황](https://semicolonxss.github.io/Formwheel_Check/)** · **[개선점 보내기](https://semicolonxss.github.io/Formwheel/feedback.html)**

### 이용 및 개발 참고

프로젝트별 기능과 로그인·실시간 동기화 지원 범위는 다를 수 있습니다. 브라우저 및 모바일에서 동작을 확인하고, 문제가 있다면 재현 단계와 기기 정보를 함께 제보해 주세요. Firebase 설정 및 데이터베이스 보안 규칙은 웹 코드 배포와 별도로 관리됩니다.

Formwheel은 게임·창작·협업 도구를 연결하는 웹 프로젝트 플랫폼입니다. © Formwheel contributors.
