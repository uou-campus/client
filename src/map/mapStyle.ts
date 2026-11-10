import type { CampusEdge } from '@/types/campus';
import { theme } from '@/styles';

/** 캠퍼스가 다 들어오는 처음 화면. */
export const CAMPUS_CENTER = { lat: 35.5442, lng: 129.2566 };

/*
 * MapLibre 배율은 512px 타일 기준이라 Leaflet(256px)보다 하나 작다.
 * 예전 Leaflet 16 이 여기서는 15 와 같은 넓이다.
 */
export const CAMPUS_ZOOM = 15;
/** 손으로 당길 수 있는 끝. 벡터 지도라 확대해도 글자와 선이 깨지지 않는다. */
export const MAX_ZOOM = 20;
/** 화면 맞추기가 고르는 최대 배율. 점 하나에 맞출 때 너무 파고들지 않게. */
export const FIT_MAX_ZOOM = 18;

/**
 * 배경 지도. OpenFreeMap 의 Liberty 스타일.
 *
 * 키도 사용량 한도도 없고, 상업적으로 써도 된다. 출처 표기(OpenFreeMap ·
 * OpenMapTiles · OpenStreetMap)는 스타일 안에 들어 있어 MapLibre 가 알아서 단다.
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * 선 하나의 모양.
 *
 * dash 는 MapLibre 규칙대로 **선 굵기의 배수**다. Leaflet 의 dashArray 는
 * 픽셀이었으니 옮길 때 굵기로 나눠 뒀다.
 */
export interface LineStyle {
  color: string;
  width: number;
  opacity: number;
  dash?: [number, number];
}

/** 캠퍼스 보행망을 가르는 갈래. 갈래마다 지도 레이어가 하나씩이다. */
export type EdgeKind =
  'connector' | 'shortcut' | 'stairs' | 'indoor' | 'road' | 'walk';

/** 아래에 깔리는 것부터. 차도가 맨 밑, 지름길이 맨 위. */
export const EDGE_KINDS: EdgeKind[] = [
  'road',
  'connector',
  'walk',
  'indoor',
  'stairs',
  'shortcut',
];

export const edgeKind = (edge: CampusEdge): EdgeKind => {
  if (edge.connector) return 'connector';
  if (edge.shortcut) return 'shortcut';
  switch (edge.surface) {
    case 'stairs':
      return 'stairs';
    case 'indoor':
      return 'indoor';
    case 'road':
      return 'road';
    default:
      return 'walk';
  }
};

/**
 * 배경으로 깔리는 캠퍼스 보행망.
 *
 * 색을 쓰지 않는다. 예전에는 보행로도 지름길도 경로와 같은 초록이었고, 굵기와
 * 투명도만 달랐다 — 「어느 선을 따라가야 하느냐」가 안 보인다는 말을 들었다.
 * 지도 타일의 공원도 초록이라 삼중으로 겹쳤다.
 *
 * 이제 지도 위에서 초록은 **가야 할 길 하나뿐**이다. 배경은 회색 농담으로만
 * 말한다 — 차도는 뒤로 물리고, 보행로·계단·지름길은 앞세우되 색은 안 준다.
 */
export const EDGE_STYLES: Record<EdgeKind, LineStyle> = {
  connector: { color: theme.gray[300], width: 1, opacity: 0.5, dash: [1, 4] },
  /* 아는 사람만 다니는 길. 색 대신 굵기와 진하기로 앞세운다. */
  shortcut: { color: theme.gray[700], width: 3.5, opacity: 0.62 },
  stairs: { color: theme.gray[500], width: 3, opacity: 0.55, dash: [0.7, 1.3] },
  indoor: { color: theme.gray[500], width: 3, opacity: 0.5, dash: [0.35, 2] },
  road: { color: theme.gray[400], width: 1.5, opacity: 0.28 },
  walk: { color: theme.gray[500], width: 2.5, opacity: 0.4 },
};

/** 편집 중에는 길을 눌러 골라야 하니 굵고 진하게. */
export const EDITING_EDGE = { width: 6, opacity: 0.7 };
/** 편집 중 고른 길. */
export const SELECTED_EDGE_COLOR = '#B45309';

/**
 * 고른 경로. 지도 위에서 초록은 이것뿐이다.
 *
 * 흰 테를 한 겹 깔아 배경과 떼어 놓는다. 공원처럼 옅은 초록이 깔린 자리를 지날
 * 때, 이 테가 없으면 선이 바닥에 잠긴다.
 */
export const routeCasingStyle: LineStyle = {
  color: theme.gray[0],
  width: 12,
  opacity: 0.95,
};

export const routeStyle: LineStyle = {
  color: theme.accent,
  width: 6,
  opacity: 1,
};

/** 비교용으로 같이 그리는 두 번째 경로. */
export const compareStyle: LineStyle = {
  color: theme.warn,
  width: 4,
  opacity: 0.85,
  dash: [1.75, 1.5],
};

/** 이미 지나온 구간. 남은 길과 헷갈리지 않게 눌러 둔다. */
export const passedStyle: LineStyle = {
  color: theme.gray[400],
  width: 5,
  opacity: 0.65,
};

/** 경로 안에서도 지름길 구간만 따로 덧그린다. */
export const shortcutOverlayStyle: LineStyle = {
  color: theme.gray[0],
  width: 2,
  opacity: 0.9,
  dash: [0.5, 3.5],
};

/**
 * 현위치의 오차 반경.
 *
 * GPS 는 '여기' 가 아니라 '이 안쪽' 을 알려 준다. 점 하나만 찍어 두면 그 점이
 * 곧 내 자리인 줄 알게 되고, 건물 안에서 30m 씩 튀는 걸 앱이 고장 난 것으로
 * 읽는다. 브라우저가 말해 준 반경을 그대로 그려 둔다.
 */
export const accuracyStyle = {
  color: '#2563EB',
  lineOpacity: 0.3,
  fillOpacity: 0.07,
};
