import { style } from '@vanilla-extract/css';
import { elevation, flex, font, layout, media, spacing, theme } from '@/styles';

/*
 * 지도 오른쪽 위에 따로 서는 설치 단추.
 *
 * 전에는 길찾기 패널 머리에 「편집」과 나란히 있었다. 폰에서 시트를 접으면
 * 그 줄이 접힌 자리 아래로 내려가 아예 안 보이고, 하루에 한 번 누를 일도 없는
 * 단추 둘이 제목 옆을 물고 있었다. 지도 위로 내보내 자기 자리를 준다.
 *
 * 왼쪽 위는 패널(넓은 화면)과 상단 안내 띠(좁은 화면)가 쓰고, 오른쪽 아래는
 * 지도 배율 단추와 출처 표기가 쓴다. 남는 자리는 오른쪽 위다.
 */
export const holder = style([
  flex.COLUMN_END,
  {
    position: 'absolute',
    zIndex: 25,
    top: spacing.md,
    right: spacing.md,
    gap: '6px',
    /* 껍데기는 손짓을 통과시킨다 — 지도를 끌다 여기 걸리면 안 된다. */
    pointerEvents: 'none',

    '@media': {
      [media.SHEET]: {
        top: `calc(${spacing.sm} + env(safe-area-inset-top, 0px))`,
        right: spacing.sm,
      },
      /* 가로로 돌리면 노치가 오른쪽으로 올 수 있다. 그 폭만큼 안으로 들어온다. */
      [media.RAIL]: {
        top: `calc(${spacing.sm} + env(safe-area-inset-top, 0px))`,
        right: `calc(${spacing.sm} + env(safe-area-inset-right, 0px))`,
      },
    },
  },
]);

const row = style([
  flex.VERTICAL,
  {
    gap: '2px',
    padding: '0 4px 0 12px',
    height: '34px',
    borderRadius: layout.radius.pill,
    border: `1px solid ${theme.accent}`,
    backgroundColor: theme.surface,
    boxShadow: elevation.overlay,
    pointerEvents: 'auto',
  },
]);

export const bar = style([row]);
export const barOpen = style([row, { backgroundColor: theme.accentSoft }]);

export const label = style([
  font.caption,
  {
    color: theme.accent,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    ':hover': { opacity: 0.75 },
  },
]);

/** 안 쓸 사람도 있다. 접을 길을 열어 둔다. */
export const close = style([
  flex.CENTER,
  {
    flexShrink: 0,
    width: '24px',
    height: '24px',
    borderRadius: layout.radius.circle,
    fontSize: '14px',
    lineHeight: 1,
    color: theme.textTertiary,

    ':hover': { backgroundColor: theme.gray[100], color: theme.textPrimary },
  },
]);

/** iOS 는 설치를 대신 눌러 줄 수 없다. 어디를 누르라고 알려만 준다. */
export const hint = style([
  font.caption,
  {
    maxWidth: '230px',
    padding: '9px 11px',
    borderRadius: layout.radius.md,
    border: `1px solid ${theme.outline}`,
    backgroundColor: theme.surface,
    color: theme.textSecondary,
    boxShadow: elevation.overlay,
    lineHeight: 1.6,
    pointerEvents: 'auto',
  },
]);

export const hintStrong = style({ color: theme.textPrimary, fontWeight: 700 });
