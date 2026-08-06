# 축제 추천 플랫폼 API 연결 테스트

기존 `RebuildProject`의 기능과 분리하여 외부 API 연결 가능성만 확인하는 Vanilla JavaScript 테스트 페이지입니다.

## 바로 실행

- [GitHub Pages에서 API 테스트 열기](https://bam090.github.io/festival-api-test/)

## 실행 방법

터미널에서 다음 명령을 실행합니다.

```bash
cd festival-api-test
python3 -m http.server 5500 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:5500`을 엽니다.

## 필요한 값

- 한국관광공사 TourAPI 일반 인증키(Decoding)
- Kakao Developers REST API 키
- Supabase Project URL과 publishable key
- 이미 만들어 둔 Supabase 로그인 테스트 계정

Supabase 테스트는 공식 호스팅 주소인 `https://*.supabase.co` 프로젝트만 허용합니다.

인증키와 계정 정보는 `localStorage`, `sessionStorage`, 파일에 저장하지 않습니다.
다만 실제 HTTP 요청에 포함되므로 브라우저 개발자 도구의 Network 탭에서는 확인할 수 있습니다.

## 테스트 항목

### TourAPI

- `searchFestival2`로 축제 목록 조회
- 목록에서 `contentid`를 선택
- `detailCommon2`로 축제 상세 조회
- 주변 검색에 필요한 `mapx`, `mapy` 좌표 확인

### Kakao Local

- 음식점 `FD6`
- 카페 `CE7`
- 숙박 `AD5`
- 중심 좌표 반경 5km, 거리순, 카테고리별 최대 5개 조회

### 연결 흐름

```text
TourAPI 축제 목록
→ 좌표가 있는 축제 선택
→ mapx와 mapy 추출
→ Kakao Local 카테고리 검색
→ 축제 주변 음식점·카페·숙박 결과 확인
```

### Supabase Auth

- 외부 SDK 없이 `/auth/v1/token?grant_type=password`에 로그인 요청
- 사용자와 세션 응답 확인
- 테스트 페이지에서는 세션을 브라우저 저장소에 남기지 않음
- 자동 회원가입은 외부 데이터를 생성하므로 수행하지 않음

## 주의사항

- 키를 JavaScript 파일에 직접 작성하거나 Git에 커밋하지 않습니다.
- 이 페이지의 브라우저 직접 호출 방식은 5일 MVP의 연결 검증용입니다.
- 실제 공개 서비스에서는 키 노출과 호출량 제어를 위해 프록시 또는 백엔드 사용을 검토해야 합니다.
- Figma ZIP은 React 기반 화면 목업이며 현재 API 데이터는 모두 하드코딩되어 있습니다. Vanilla JavaScript 프로젝트의 시각·상호작용 참고 자료로만 사용합니다.
