import { globalStyle, globalFontFace } from '@vanilla-extract/css';
import theme from './theme';
import font from './font';
import elevation from './elevation';
import pretendardSubset from './pretendard-subset.woff2';

export const pretendard = 'Pretendard';

/*
 * 원본(2,008 KB)이 아니라 이 앱이 쓰는 글자만 남긴 서브셋(105 KB)을 쓴다.
 * `scripts/make-font.mjs` 가 빌드마다 다시 뽑는다.
 *
 * 남의 CDN 이 아니라 우리 쪽에서 내보낸다. 첫 화면에 꼭 필요한 파일을 남의
 * 도메인에 두면 연결을 새로 트는 값(DNS·TLS)을 그대로 문다. 자리는 Vite 에게
 * 맡긴다 — 이름에 해시가 붙어 /assets/ 로 나가므로 내용이 바뀌면 주소도 바뀌고,
 * 캐시를 끊으려고 사람이 판 번호를 챙길 일이 없다.
 *
 * preload 는 일부러 안 건다. 재 봤더니 느린 회선(1.6Mbps)에서 첫 그림이
 * 1,120ms → 1,720ms 로 되레 밀렸다 — 글꼴이 높은 우선순위로 끼어들어 정작
 * 화면을 그리는 JS 와 대역폭을 다투기 때문이다. swap 이라 첫 그림은 어차피
 * 대체 글꼴로 나가고, 이 글꼴은 670ms 면 도착해 조용히 바뀐다.
 */
globalFontFace(pretendard, {
  src: `url("${pretendardSubset}") format("woff2-variations")`,
  /* 축을 400~700 으로 좁혔다. 화면에서 쓰는 굵기가 그 둘뿐이다. */
  fontWeight: '400 700',
  fontStyle: 'normal',
  fontDisplay: 'swap',
});

globalStyle('*, *::before, *::after', {
  margin: 0,
  padding: 0,
  boxSizing: 'border-box',
});

globalStyle('html, body, #root', {
  width: '100%',
  height: '100%',
});

/* 지도가 화면을 꽉 채우므로 문서 자체는 스크롤하지 않는다. */
globalStyle('body', {
  overflow: 'hidden',
  overscrollBehavior: 'none',
});

globalStyle('html', {
  fontSize: '16px',
});

globalStyle('body', {
  fontFamily: `-apple-system, system-ui, ${pretendard}, 'Segoe UI', Roboto, sans-serif`,
  fontSize: '0.875rem',
  color: theme.textPrimary,
  backgroundColor: theme.background,
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
});

globalStyle('a', {
  color: 'inherit',
  textDecoration: 'none',
});

globalStyle('button', {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: 'inherit',
});

globalStyle('input, textarea, select', {
  border: 'none',
  outline: 'none',
  fontFamily: 'inherit',
});

globalStyle('ul, ol', {
  listStyle: 'none',
});

globalStyle('img', {
  display: 'block',
  maxWidth: '100%',
});

globalStyle('table', {
  width: '100%',
  borderCollapse: 'collapse',
});

globalStyle('th, td', {
  textAlign: 'left',
});

/* 키보드 포커스는 보이게 두되, 마우스 클릭에는 링이 뜨지 않게. */
globalStyle(':focus-visible', {
  outline: `2px solid ${theme.accent}`,
  outlineOffset: '2px',
});

/* ── MapLibre 기본 껍데기를 이 앱 톤으로 눌러 둔다 ─────────────────────── */

globalStyle('.maplibregl-map', {
  fontFamily: 'inherit',
  backgroundColor: theme.gray[100],
});

globalStyle('.maplibregl-ctrl-attrib', {
  ...font.caption,
  backgroundColor: 'rgba(255, 255, 255, 0.82)',
  color: theme.textTertiary,
});

globalStyle('.maplibregl-ctrl-attrib a', {
  color: theme.textSecondary,
});

globalStyle('.maplibregl-ctrl-group', {
  boxShadow: elevation[1],
});

globalStyle('.maplibregl-ctrl-group button + button', {
  borderTopColor: theme.outline,
});
