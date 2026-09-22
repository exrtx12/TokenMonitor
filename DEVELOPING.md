# 개발자 가이드

이 문서는 코드를 고치거나 직접 빌드할 사람을 위한 것입니다.
받는 사람용 안내는 [README.md](README.md), 구조와 설계 의도는 [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)에 있습니다.

---

## 개발 중 실행

```
cd desktop
npm install
npm start
```

> **`ELECTRON_RUN_AS_NODE` 주의.** 이 변수가 설정된 셸에서 `npm start`를 하면 Electron이 일반 Node로 실행되어
> `app.requestSingleInstanceLock is undefined` 로 즉시 죽습니다. 실행 전에 변수를 지우세요.

## 배포용 빌드

```
cd desktop
npm run dist
```

- `desktop/dist/AI Usage Widget Setup 0.4.0.exe` — 설치형
- `desktop/dist/AI Usage Widget 0.4.0.exe` — 포터블

> Windows **개발자 모드**가 꺼져 있으면 `winCodeSign` 압축 해제 단계에서 심볼릭 링크 권한 오류가 납니다.
> 설정 → 개발자용 → 개발자 모드를 켜면 해결됩니다.

## 배포 체크리스트

1. `desktop/package.json`의 **`version`을 올립니다.** 빌드 결과 파일 이름에 버전이 들어가므로,
   받는 사람이 새 버전인지 구분할 수 있습니다.
2. **[README.md](README.md)의 버전 표기를 같이 고칩니다.** 설치 파일 이름과 제거 항목 예시에
   버전이 박혀 있어, 안 고치면 받는 사람이 헷갈립니다.
3. `npm run dist`
4. 체크섬을 함께 공유합니다.
   ```powershell
   Get-FileHash "desktop\dist\AI Usage Widget Setup 0.4.0.exe" -Algorithm SHA256
   ```
5. **exe 파일과 [README.md](README.md)를 같이 전달합니다.** README는 그대로 배포해도 되도록
   사용자용 내용만 담겨 있습니다 (개발자용 내용은 이 문서에 분리해 두었습니다).

> `package.json`의 `author.name`이 설치 정보의 **게시자**, exe 속성의 **회사 이름**, 저작권 문자열에
> 들어갑니다. 비워두면 셋 다 공란이 되고 빌드 시 `author is missed` 경고가 뜹니다.
> 다만 이 값과 무관하게, 코드 서명이 없으면 받는 쪽 SmartScreen에는 계속 "게시자: 알 수 없음"으로 나옵니다.

## 서비스 추가 (Gemini 등)

`desktop/services/`에 모듈을 만들고 `registry.js`에 등록합니다. 모듈 계약은
[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)의 "서비스 모듈 계약" 절에 있습니다.

실제 사용량 API의 요청 URL과 응답 JSON 샘플을 먼저 확보하세요.
짐작으로 만들면 API가 조금만 바뀌어도 깨집니다.
