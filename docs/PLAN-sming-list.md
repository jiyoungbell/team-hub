# 슴리 계산기 계획 (team.rescene-remine.com/sming-list)

2026-10-27 사용자와 함께 정한 계획. 각 세션은 이 파일과 `docs/PLAN.md`(허브 전체)를 먼저 읽는다. 여기 적힌 결정은 다시 묻지 않는다. 여기 없는 결정이 생기면 사용자에게 묻는다.

## 1. 목표

스밍리스트(슴리)를 짤 때 쓰는 **곡 조회 + 재생시간 계산기**. 음원 사이트는 곡마다 1시간에 한 번 집계하기 때문에, 팀은 한 바퀴가 1시간 안팎이 되도록 재생목록을 짜서 공지한다.

- **기능은 최소로.** 곡을 넣으면 재생시간·누적·합계를 보여 줄 뿐이다. 목표 시간, 판정, 경고, 자동 짜기는 없다.
- 슴리는 곡 중심이다. 한 번 짜면 모든 음원 사이트에서 쓴다. 음원 사이트는 **곡 조회용**일 뿐이라 멜론 하나만 쓴다. 사이트별 시간 비교는 없다.
- **아직 발매 안 된 곡**도 넣을 수 있어야 한다. 컴백 전에 수록곡 제목과 길이가 먼저 공개되고, 슴리는 그때 미리 짠다.
- 짠 슴리는 허브에 저장해 팀원끼리 같이 보고 고친다.

## 2. 멜론 (2026-10-27 홈서버에서 curl 로 확인)

- 검색: `https://www.melon.com/search/keyword/index.json?query=…&jscallback=…` (JSONP). 곡 번호, 제목, 가수, 앨범, 커버(`ALBUMIMG`)가 온다. 재생시간은 없다. 빌지메이커 `../bill-ji-maker/worker/providers/melon.ts` 를 가져온다(검색어 20자 제한, 두 번 인코딩, JSONP 처리 포함).
- 재생시간: `https://m2.melon.com/m6/v2/song/info.json?songId=<id>` → `response.SONGINFO.PLAYTIME` (초, 문자열). LOVE ATTACK `"182"` = 3:02.
- Worker(Cloudflare IP)에서도 같은 응답이 오는지는 1단계 처음에 확인한다. 막히면 사용자에게 알린다.

## 3. 구성

```
브라우저 ─▶ team.rescene-remine.com (Worker)
             /sming-list 화면 ── D1 slists
                └── 곡 검색 ─▶ melon.com, m2.melon.com
```

- 허브 Worker 안의 페이지. 로그인한 팀원만. 홈서버·team-gate 는 손대지 않는다.
- 화면은 서버에서 HTML 을 만들고, 목록 편집·계산은 `public/sming-list.js`.
- 곡 표는 따로 두지 않는다. 곡 정보는 슴리 안에 함께 저장한다(6절).

## 4. 곡 넣기

- **검색**: 검색창 입력 → `GET /sming-list/search?q=` → 멜론 검색 결과(커버, 제목, 가수, 앨범). 누르면 그때 재생시간을 받아 목록 끝에 넣는다.
- **직접 넣기** (미발매 곡): 제목, 재생시간(`m:ss`). 가수는 선택.
- **연결**: 직접 넣은 곡을 발매 후 멜론 곡으로 바꾼다. 그 슴리 안의 같은 곡 줄이 모두 바뀐다.

## 5. 화면

첨부 이미지(PLAVE HYPERDRIVE 슴리)의 표 모양을 따른다.

- `/sming-list`: 저장된 슴리 목록(이름, 곡 수, 합계, 마지막으로 고친 사람·시각) + 새로 만들기.
- `/sming-list/<id>`:
  - 이름(고칠 수 있음), 검색창.
  - 표: 번호 · 커버 · 제목 · 재생시간 · **누적**. 끝에 합계.
  - 줄: 끌어서 순서 바꾸기, 복제, 삭제.
  - 곡별 횟수 한 줄: `Star Trace 5 · 꿈 5 · 푸른 하늘에 단비 4 · …`.
  - 텍스트 복사(`01 Star Trace 02:59` … `Total 1:00:00`), 복사해서 새 슴리.
- 디자인 원칙은 할 일 보드와 같다(`docs/PLAN.md` 7절): 라벨·데이터·짧은 동작어만, 설명 문장·이모지 없음, 다크/라이트, 폰 폭.

## 6. 저장

- 팀원 누구나 열고 고친다. 고치면 바로 저장. 받은 버전과 서버 버전이 다르면 덮어쓰지 않고 최신을 다시 보여 준다.
- 삭제는 만든 사람과 관리자만.

```sql
CREATE TABLE slists (
  id TEXT PRIMARY KEY,            -- 주소에 쓰는 짧은 번호
  name TEXT NOT NULL,
  songs TEXT NOT NULL,            -- JSON {key: {melon_id?, title, artist?, cover?, sec}}. key 는 멜론 곡 번호, 직접 넣은 곡은 임의 번호
  items TEXT NOT NULL,            -- JSON 배열: songs 의 key 순서대로
  version INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
```

## 7. 단계

| 단계 | 내용 | 끝났다는 기준 |
|---|---|---|
| 0 | 화면 시안, 사용자 확정 | 사용자가 시안을 고름 (2026-10-27, https://claude.ai/artifact/HrAgbVtbbpxmvhC6c936iB 비공개) |
| 1 | Worker 에서 멜론 응답 확인. 검색·재생시간 API, `slists`, 화면, 옆 메뉴·헤더 메뉴에 "슴리 계산기". 테스트(멜론 응답은 가짜로) | 첨부 이미지의 슴리를 그대로 짜면 합계가 같게 나옴. 미발매 곡을 직접 넣고 나중에 연결할 수 있음. 폰 폭 확인 |

- 커밋은 영어 Conventional Commits. 배포는 main 에 올리면 CI 가 마이그레이션 후 배포.
- 세션 끝에 이 파일 끝에 "한 일 / 남은 일"을 적는다.

## 한 일 (2026-10-27)

- 0·1단계. `/sming-list`, `/sming-list/<id>`, 검색, 저장(버전 확인), 복사해서 새로, 삭제(만든 사람·관리자), 옆 메뉴·헤더 메뉴. 마이그레이션 `0007_sming_list.sql`.
- 시안과 달라진 것: 순서 바꾸기는 손잡이(⠿)를 끌거나, 손잡이에 초점을 두고 위아래 화살표. 직접 넣은 곡은 커버 자리가 점선이고 제목 옆 `연결`을 누르면 검색창이 그 제목으로 열린다(Esc 로 취소). 재생시간을 못 받은 검색 결과는 고를 수 없다.
- 확인: 테스트(멜론 응답은 가짜), 홈서버에서 실제 멜론으로 Chromium 확인(검색·재생시간 03:02, 첨부 이미지 20곡 합계 1:00:00, 연결, 끌기, 새로고침 후 유지, 먼저 저장된 버전으로 바뀜, 폰 폭 390px 가로 스크롤 없음, 라이트).

## 남은 일

- Worker(Cloudflare IP)에서 멜론이 답하는지는 배포 후 확인. 막히면 검색이 "멜론 응답 없음"으로 나오고 로그에 `melon_failed` 가 남는다.
