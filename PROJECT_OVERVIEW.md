# 프로젝트 개요 (처음 보는 사람용)

이 문서는 저장소를 처음 열어본 사람이 "이게 뭐고, 왜 이렇게 생겼는지"를 파악하기 위한 문서입니다.
앱 사용법은 [README.md](README.md), 실행·빌드·배포 방법은 [DEVELOPING.md](DEVELOPING.md)에 있습니다.

---

## 1. 한 줄 요약

로그인된 **claude.ai / ChatGPT의 사용량 한도**(5시간 세션, 7일 주간)를 5분마다 조회해서,
바탕화면에 항상 떠 있는 작은 위젯에 막대그래프와 리셋 카운트다운으로 보여주는 Electron 앱입니다.

---

## 2. 어떻게 지금 형태가 되었나 (개발 경과)

이 프로젝트는 요구사항이 단계적으로 바뀌면서 형태가 여러 번 변했습니다. 코드에 남아 있는
흔적들을 이해하려면 이 순서를 알아야 합니다.

| 단계 | 내용 |
|---|---|
| 1 | **크롬 확장 프로그램**으로 시작. claude.ai 사용량을 툴바 배지 + 팝업에 표시 |
| 2 | "바탕화면 위젯으로 보고 싶다" → 브라우저 밖에서는 확장이 동작할 수 없으므로 **Electron 데스크톱 앱**을 별도로 추가 (`desktop/`) |
| 3 | 알림이 리셋 때가 아니라 **사용량이 갱신될 때마다** 울리는 버그 발견 → 리셋 판정 로직 수정 |
| 4 | **ChatGPT 연동** 추가. 이 과정에서 데스크톱 앱을 단일 서비스 → **다중 서비스 구조로 리팩터링** |
| 5 | 위젯 숨기기 후 되살리기 어려운 문제 → 트레이 아이콘 좌클릭 토글로 UX 개선 |
| 6 | cmd 창 없이 쓰고 싶다 → **electron-builder로 exe 패키징** (설치형 + 포터블) |
| 7 | 최종적으로 **데스크톱 위젯만 사용**하기로 결정 |
| 8 | 배포를 앞두고 **백그라운드 메모리 522MB가 과하다**는 문제 → 상시 숨김 창을 걷어내고 `session.fetch()`로 전환, **341MB로 감소** (4절 참고) |
| 9 | 여러 사람에게 배포하게 되면서 **쓰는 AI만 골라 보는 기능**이 필요해짐 → `enabled`를 사용자 설정으로 바꾸고 트레이에 토글 추가. 같은 틀에 **Gemini 슬롯**을 '준비 중' 상태로 추가 |

> **중요**: 7단계 결정에 따라 README에서는 크롬 확장 내용을 걷어냈지만, **확장 프로그램 코드 자체는
> 저장소 루트에 그대로 남아 있습니다**. 루트의 `manifest.json`, `background.js`, `popup/`,
> `services/`, `storage.js`, `icons/`는 **레거시**이며 현재 유지보수 대상이 아닙니다.
> 실제로 쓰는 코드는 전부 `desktop/` 안에 있습니다.

---

## 3. 폴더 구조

```
TokenMonitor/
├── desktop/                  ← ★ 현재 사용하는 Electron 앱 (여기만 보면 됩니다)
│   ├── main.js                  메인 프로세스: 창 관리, 트레이, 5분 폴링, 사용량 조회, 알림
│   ├── preload.js               렌더러에 안전한 IPC API(window.api) 노출
│   ├── store.js                 설정/상태를 userData의 store.json에 저장 (메모리 캐시 사용)
│   ├── services/
│   │   ├── base.js              공통 계약: UsageError(에러 코드 정의)
│   │   ├── claude.js            claude.ai 사용량 조회 + 조직(org) 자동 감지
│   │   ├── chatgpt.js           chatgpt.com 사용량 조회
│   │   ├── gemini.js            자리만 있는 '준비 중' 슬롯 (엔드포인트 미확인)
│   │   └── registry.js          앱이 아는 전체 서비스 목록 (여기에 등록해야 인식)
│   ├── widget/                  위젯 UI (index.html / style.css / renderer.js)
│   ├── assets/                  트레이·앱 아이콘
│   └── dist/                    빌드 결과물 (.exe) — 빌드 시 생성
│
├── samples/claude-usage.json ← 실제 API 응답 샘플 (구현 근거)
├── scripts/*.py              ← 아이콘 생성 스크립트 (Pillow)
├── README.md                 ← 사용자용 안내 (배포 시 exe와 함께 전달, 개발 내용 없음)
├── DEVELOPING.md             ← 개발자용: 실행 / 빌드 / 배포 체크리스트 / 서비스 추가
│
└── (레거시) manifest.json, background.js, popup/, services/, storage.js, icons/
```

---

## 4. 데스크톱 앱 동작 방식

### 프로세스/창 구성
```
메인 프로세스 (main.js)
├── 위젯 창              → 프레임 없는 투명 창, 항상 위, 트레이로 숨김 가능
├── 로그인 창 (필요 시)    → 각 서비스 로그인용 일반 브라우저 창
├── 페이지 창 (폴백 전용)  → 평소엔 존재하지 않음. 아래 "인증" 참고
└── 트레이 아이콘         → 좌클릭: 위젯 토글 / 우클릭: 메뉴
```

상시로 떠 있는 창은 **위젯 창 하나뿐**입니다. 실행 중 프로세스는 4개(main / gpu / 위젯 렌더러 / utility),
메모리는 약 341MB입니다.

### 인증을 이렇게 처리하는 이유 (핵심)

사용량 API가 **쿠키 기반 세션 인증**이라 토큰을 따로 얻을 방법이 마땅치 않습니다. 그래서:

1. 서비스별로 **영속 세션 파티션**(`persist:claude-usage-widget` 등)을 둡니다.
   사용자가 로그인 창에서 한 번 로그인하면 쿠키가 여기에 남아 앱을 껐다 켜도 유지됩니다.
2. 사용량 조회는 메인 프로세스에서 **`session.fromPartition(...).fetch(url, { credentials: "include" })`**
   로 직접 보냅니다. Chromium 네트워크 스택을 그대로 쓰므로 브라우저 탭에서 요청한 것과 동일하게
   쿠키가 실려 나가고, **렌더러(창)가 전혀 필요 없습니다.**

> **왜 이 방식으로 바뀌었나.** 원래는 서비스마다 숨김 `BrowserWindow`에 claude.ai / chatgpt.com을
> 통째로 띄워 두고 `webContents.executeJavaScript()`로 그 페이지 안에서 `fetch()`를 실행했습니다.
> 동작은 했지만 **풀 SPA를 24시간 메모리에 올려두는 대가**가 컸습니다 — 실측으로 렌더러 2개가
> 157MB + 150MB, 전체 522MB 중 59%였습니다. `session.fetch()`로 바꿔 이 둘을 통째로 없앴고
> 전체가 341MB가 됐습니다.

**폴백(fallback).** 사이트가 페이지 컨텍스트에서 온 요청만 받아주도록 바뀔 가능성에 대비해,
기존 방식도 남겨뒀습니다. 다만 상시 유지가 아니라:

- `session.fetch()`가 인증/네트워크/스키마 오류로 실패하면 그때만 창을 띄워 재시도합니다
- 성공한 경로를 서비스별로 기억해(`fetchModes`) 다음 폴링부터는 헛된 재시도를 하지 않습니다
- 폴링이 끝나면 **15초 뒤 창을 파괴**합니다 (한 번의 폴링 안에서 일어나는 2~3회 요청은 창을 재사용)
- 폴백 창이 로드하는 주소는 홈이 아니라 `bootstrapUrl`(= `robots.txt`)입니다. 필요한 건 "그 오리진의
  문서"일 뿐이라, SPA 대신 텍스트 문서만 띄웁니다
- `MULTI_ACCOUNT` / `ACCOUNT_NOT_SET` 오류는 요청 자체는 성공한 것이므로 폴백하지 않습니다

현재 Claude·ChatGPT 모두 폴백 없이 `session.fetch()`만으로 동작합니다.
어느 경로를 탔는지 확인하려면 `WIDGET_LOG=1` 환경변수를 주고 실행하세요
(`[net] ...` / `[page] create` 로그가 찍힙니다).

### 서비스 on/off

어떤 서비스를 보여줄지는 **사용자 설정**입니다. 모듈의 `defaultEnabled`는 첫 실행 때의 초깃값일 뿐이고,
이후에는 `store.getServiceEnabled(id, defaultEnabled)`가 답을 줍니다. 그래서 `enabledServices()`는
매번 새로 계산하며, 어디에도 목록을 캐시해 두지 않습니다.

토글이 바뀌면 `setServiceEnabled()` → `applyServiceChange()`가:

1. 위젯에 `services-update`를 보내 **카드 목록을 통째로 다시 만들게** 합니다 (부분 갱신하지 않음)
2. 켠 경우 즉시 폴링하고, 끈 경우 그 서비스의 페이지 창과 `fetchModes` 항목을 버립니다
3. **쿠키와 저장된 설정은 건드리지 않습니다.** 다시 켰을 때 재로그인을 요구하지 않기 위해서입니다

### 위젯 높이는 렌더러가 잽니다

창이 프레임 없는 투명 창이라, 카드 아래 남는 여백은 **보이지 않으면서 바탕화면 클릭을 먹는 사각형**이 됩니다.
그래서 카드 개수로 높이를 추정하지 않고, 렌더러가 `ResizeObserver`로 실제 콘텐츠 높이를 재서
`content-height`로 알려주면 메인이 창을 그 크기로 맞춥니다. 에러 배너가 생기고 사라지는 것까지 자동으로 따라옵니다.
`widgetHeight()`의 추정치는 렌더러가 첫 화면을 그리기 전, 창을 처음 만들 때만 씁니다.
(추정 공식을 쓰던 때는 실제보다 106px 큰 창이 떠 있었습니다.)

### 데이터 흐름
```
setInterval(5분)
  → 각 서비스 fetchUsage()  → { session:{percent, resetsAt}, weekly:{percent, resetsAt} } 로 정규화
  → store.json에 저장       → 리셋 발생 시 알림
  → IPC로 위젯에 push       → 막대/카운트다운 렌더링
```

### 서비스 모듈 계약
새 서비스(Gemini 등)를 붙이려면 `desktop/services/`에 아래 형태의 모듈을 만들고 `registry.js`에 등록합니다.

```js
module.exports = {
  id, name,
  defaultEnabled,      // 첫 실행 때 켜진 상태로 둘지 (이후엔 사용자 설정이 우선)
  comingSoon,          // true면 폴링하지 않고 '준비 중' 카드만 표시
  hasAccountSetting,   // 조직/계정 수동 설정 UI(톱니바퀴)를 보여줄지
  homeUrl,             // Referer/Origin 헤더에 쓰이고, 폴백 창의 최종 대체 주소
  bootstrapUrl,        // 폴백 창이 먼저 시도할 가벼운 동일 오리진 주소 (예: robots.txt)
  loginUrl,            // 로그인 창이 열 주소
  partition,           // 세션 파티션 이름 (서비스별로 분리)
  fetchUsage(settings, runFetch),   // → { session, weekly } 반환, 실패 시 UsageError throw
};
```

`fetchUsage`는 `runFetch(url, extraHeaders)`를 받아 씁니다. 이 함수가 `session.fetch`를 쓸지
페이지 컨텍스트를 쓸지는 `main.js`가 정하므로, 서비스 모듈은 신경 쓸 필요가 없습니다.

에러는 반드시 `UsageError`로 던지며, 코드에 따라 위젯 UI가 달라집니다:
`AUTH_ERROR`(로그인 버튼) / `MULTI_ACCOUNT`(조직 선택 버튼) / `SCHEMA_ERROR` / `NETWORK_ERROR` / `ACCOUNT_NOT_SET`.

---

## 5. 나중에 보면 이해 안 될 만한 설계 판단들

- **리셋 알림 판정**: `resets_at` 값이 바뀌면 리셋이라고 보면 안 됩니다. 이 한도는 **롤링 윈도우**라
  사용량이 늘 때마다 `resets_at`이 미래로 밀립니다. 그래서 "이전에 예고됐던 리셋 시각이 **실제로 지난
  뒤에** 값이 바뀐 경우"만 진짜 리셋으로 판정합니다 (`didWindowReset()`).
- **`session.fetch` 우선, 페이지 컨텍스트는 폴백**: 위 4절 참고. 동작하는 코드를 "혹시 몰라서"
  상시로 켜두면 메모리를 그만큼 낸다는 게 이 프로젝트에서 가장 비쌌던 교훈입니다.
- **org_id 하드코딩 금지**: Claude는 `/api/organizations`로 자동 감지하고, 조직이 여러 개면 위젯에서
  고르게 하며, 톱니바퀴로 수동 입력도 가능합니다. ChatGPT는 계정 개념이 필요 없어
  `hasAccountSetting: false`로 두어 설정 UI 자체를 숨깁니다.
- **응답 스키마 검증**: API 응답 형식이 바뀌면 조용히 잘못된 숫자를 보여주는 대신
  `SCHEMA_ERROR`로 명확히 실패시킵니다.
- **세션 파티션 분리**: 서비스마다 파티션을 나눠 한쪽 로그인 문제가 다른 쪽에 영향을 주지 않게 했습니다.
- **ChatGPT 토큰 재시도**: 쿠키만으로 401이 나면 `/api/auth/session`에서 accessToken을 받아
  `Authorization: Bearer`로 한 번 더 시도합니다. (로그에서 401 → 200 순서로 보이는 게 정상입니다)
- **store.js 메모리 캐시**: 파일을 건드리는 건 메인 프로세스뿐이라, getter마다 `store.json`을 다시
  읽고 파싱하지 않고 파싱된 사본을 들고 있습니다.
- **카운트다운은 위젯이 보일 때만**: 위젯은 대부분 트레이에 숨겨져 있으므로, `visibilitychange`로
  1초 타이머를 멈춥니다. 아무도 못 보는 화면을 매초 다시 그릴 이유가 없습니다.

---

## 6. 개발 중 밟은 지뢰들 (같은 삽질 반복 방지)

- **`ELECTRON_RUN_AS_NODE=1`**: 이 환경변수가 설정된 셸에서 `npm start`를 하면 Electron이 일반
  Node처럼 실행되어 `require('electron')`이 API 대신 경로 문자열을 반환합니다
  (`app.requestSingleInstanceLock is undefined` 에러). 실행 전 이 변수를 지워야 합니다.
  **패키징된 exe도 마찬가지**라, 그런 셸에서 `Start-Process`로 띄우면 조용히 즉시 종료됩니다.
- **`app.disableHardwareAcceleration()`은 GPU 프로세스를 없애지 않습니다**: 메모리를 더 줄이려고
  "저사양 모드" 토글을 넣어봤지만, 하드웨어 가속을 꺼도 GPU 프로세스는 소프트웨어 합성용으로
  그대로 살아 있고 메모리도 105MB로 동일했습니다(실측). 효과가 없어 기능을 제거했습니다.
- **투명 창 스크린샷**: Windows `PrintWindow`(GDI) 방식으로 캡처하면 아이콘·SVG 등이 안 찍혀서
  "렌더링이 깨진 것"처럼 보입니다. 실제로는 정상이며, 검증하려면
  `webContents.capturePage()`로 앱이 직접 캡처해야 정확합니다.
- **`npm install` 후 electron이 안 받아짐**: 이 환경은 `allow-scripts` 정책으로 postinstall이
  차단되어 electron 바이너리가 안 내려옵니다. `npm approve-scripts electron` 후 재설치해야 합니다.
- **빌드 시 winCodeSign 오류**: electron-builder가 Windows 빌드에도 macOS 서명 도구를 받아 푸는데,
  그 안의 심볼릭 링크 때문에 권한 오류가 납니다. **Windows 개발자 모드**를 켜면 해결됩니다
  (이 PC는 이미 켜둔 상태).
- **메모리를 잴 때는 같은 조건끼리**: 갓 띄운 프로세스는 워킹셋이 아직 안 줄어 실제보다 크게 나옵니다.
  또 `npm start`(dev)와 패키징된 exe는 수치가 크게 다릅니다(구조 개선 전 기준 dev 1264MB / 패키지 522MB).
  개선 전후를 비교할 땐 **둘 다 같은 방식으로 띄워** 재야 의미가 있습니다.

---

## 7. 현재 상태와 남은 것

**되는 것**: Claude/ChatGPT 사용량 표시, 5분 자동 갱신, KST 리셋 시각 + 카운트다운, 80% 이상 빨간 막대,
리셋 알림, 트레이 제어, 위치 기억, 시작 프로그램 등록, exe 패키징.

**안 된 것 / 해볼 만한 것**:
- **Gemini 연동** — `desktop/services/gemini.js`에 자리는 잡아뒀지만 `comingSoon: true` 상태입니다.
  **막힌 지점은 엔드포인트입니다.** 이 앱은 사이트가 이미 계산해 둔 사용률을 읽어오는 구조인데
  (Claude는 `/api/organizations/{id}/usage`, ChatGPT는 `/backend-api/wham/usage`),
  Gemini 웹에서 그에 대응하는 요청이 확인되지 않았습니다. 애초에 Gemini UI가 한도를 %로 보여주지
  않는다면 읽어올 숫자 자체가 없는 것이라, 먼저 **그게 존재하는지부터** 확인해야 합니다.
  확인되면 `fetchUsage`를 채우고 `comingSoon`만 지우면 됩니다.
- **자동 업데이트 없음** — 코드를 고치면 다시 빌드해서 배포해야 하고, 받는 쪽도 직접 다시 설치해야 합니다.
- **코드 서명 없음** — 배포하면 수신자 PC에서 SmartScreen 경고가 뜹니다 (정상, README에 안내 문구 있음).
- **메모리 341MB** — 남은 건 대부분 Electron 자체 베이스라인(gpu 109 / main 99 / 렌더러 79 / utility 53)이라,
  더 줄이려면 프레임워크를 벗어나는 선택(트레이 전용 네이티브 앱 등)이 필요합니다.
- **레거시 확장 코드 정리** — 루트의 확장 파일들을 지울지 남길지 아직 결정되지 않았습니다.
