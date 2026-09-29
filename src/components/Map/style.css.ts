import { globalStyle, style } from '@vanilla-extract/css';
import { elevation, flex, font, layout, theme } from '@/styles';

export const container = style({
  position: 'absolute',
  inset: 0,
  zIndex: 0,
});

/* Leaflet 이 divIcon 에 자기 테두리를 붙인다. 전부 걷어낸다. */
globalStyle('.leaflet-div-icon', {
  background: 'transparent',
  border: 'none',
});

const dot = style([
  flex.CENTER,
  font.caption,
  {
    width: '22px',
    height: '22px',
    borderRadius: layout.radius.circle,
    fontSize: '10px',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
    transition: 'transform 0.12s',

    ':hover': { transform: 'scale(1.18)' },
  },
]);

export const place = style([
  dot,
  {
    backgroundColor: theme.surface,
    border: `2px solid ${theme.gray[400]}`,
    color: theme.textSecondary,
    boxShadow: elevation[1],
  },
]);

export const gate = style([
  dot,
  {
    backgroundColor: theme.gray[700],
    border: `2px solid ${theme.gray[0]}`,
    color: theme.gray[0],
  },
]);

/** 의무실. 급할 때 한눈에 찾도록 건물 점과 색을 가른다. */
export const medical = style([
  dot,
  {
    backgroundColor: theme.error,
    border: `2px solid ${theme.gray[0]}`,
    color: theme.gray[0],
    fontSize: '14px',
    boxShadow: elevation[1],
  },
]);

/** 편집 모드에서 확대했을 때만 보이는 길목. */
export const junction = style({
  width: '12px',
  height: '12px',
  borderRadius: layout.radius.circle,
  backgroundColor: theme.warnSoft,
  border: `2px solid ${theme.warn}`,
  cursor: 'pointer',
  transition: 'transform 0.12s',

  ':hover': { transform: 'scale(1.35)' },
});

export const endpoint = style([
  dot,
  {
    width: '28px',
    height: '28px',
    fontSize: '12px',
    backgroundColor: theme.accent,
    border: `2px solid ${theme.gray[0]}`,
    color: theme.onAccent,
    boxShadow: elevation.overlay,
  },
]);

export const endpointTo = style([
  endpoint,
  { backgroundColor: theme.gray[900] },
]);

/** 좌표를 아직 못 믿는 노드는 테를 점선으로 둔다. */
export const approx = style({
  borderStyle: 'dashed',
});

export const here = style({
  width: '18px',
  height: '18px',
  borderRadius: layout.radius.circle,
  backgroundColor: '#2563EB',
  border: `3px solid ${theme.gray[0]}`,
  boxShadow: '0 0 0 6px rgba(37, 99, 235, 0.18)',
});

/* 이름표. 확대해야 뜬다. */
globalStyle('.leaflet-tooltip.campus-label', {
  ...font.caption,
  padding: '1px 6px',
  border: 'none',
  borderRadius: layout.radius.xs,
  backgroundColor: 'rgba(255, 255, 255, 0.92)',
  color: theme.textPrimary,
  boxShadow: elevation[1],
  whiteSpace: 'nowrap',
});

globalStyle('.leaflet-tooltip.campus-label::before', {
  display: 'none',
});

/** 확대 배율이 낮을 땐 이름표를 통째로 접는다. */
globalStyle('.campus-map--far .leaflet-tooltip.campus-label', {
  display: 'none',
});
