import type { Weekday } from '@/types/timetable';
import { buildingNoOf, looksLikeRoomCode, repairRoom } from './room';

/**
 * 에브리타임에서 내려받은 시간표 그림을 읽는다.
 *
 * 글자를 다 읽으려 들지 않는다. 요일은 칸의 가로 자리, 시각은 세로 자리에
 * 적혀 있어서, 글자로 알아내야 하는 건 강의실 코드 하나뿐이다.
 *
 * 과목 이름은 아예 안 가져온다. 인식이 절반쯤밖에 안 맞아 「창업아이디어설계」가
 * 「창」으로 들어왔는데, 길찾기에 쓰이지도 않는 값을 그렇게 어설프게 들고 있으면
 * 화면만 지저분해진다. 큰 언어 데이터(6.6MB)로도 정확도가 그대로여서 — 재 봤다 —
 * 더 받아서 될 일도 아니었다. 어디로 가느냐는 강의실 하나로 정해진다.
 *
 * 읽은 값은 그대로 쓰지 않는다. 확인 화면에서 사람이 보고 고친 뒤에야 시간표가
 * 된다. 그래서 여기서는 '확실하지 않다' 를 숨기지 않고 같이 넘긴다.
 */

export interface ParsedSlot {
  day: Weekday;
  startMinutes: number;
  endMinutes: number;
  /** 읽어 낸 강의실. 못 읽었으면 빈 문자열 — 확인 화면에서 채운다. */
  room: string;
  /** 강의실을 얼마나 믿을 수 있는지(0~100). 낮으면 확인 화면에서 먼저 보여 준다. */
  confidence: number;
}

export interface ParseResult {
  slots: ParsedSlot[];
  /** 사람이 알아야 할 것. 못 읽은 칸, 못 찾은 시간축 같은 것. */
  warnings: string[];
}

/**
 * 아무것도 없는 흰 바탕인지.
 *
 * 처음에는 '옅고 채도가 낮으면 글자나 눈금선' 으로 걸렀다. 그랬더니 옅은
 * 회분홍(#f7f2f2 같은) 수업 칸이 통째로 버려졌다 — 채도로는 옅은 칸과 회색
 * 선을 가를 수 없다. 실제로 기초확률 한 칸이 그렇게 사라졌다.
 *
 * 그래서 흰색만 바탕으로 본다. 눈금선도 글자도 '바탕이 아닌 것' 으로 함께
 * 걸리지만, 선은 한두 픽셀이라 높이로 걸러지고, 글자는 칸 안에 있으니 같은
 * 칸으로 이어 붙으면 그만이다.
 */
const isPaper = (r: number, g: number, b: number) =>
  r > 249 && g > 249 && b > 249;

/** 글자인지. 칸 색을 견줄 때 글자 픽셀에 속지 않으려고 쓴다. */
const isGlyph = (r: number, g: number, b: number) => (r + g + b) / 3 < 170;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** 두 색이 눈에 띄게 다른지. 맞붙은 칸을 가르는 데 쓴다. */
const differs = (a: number[], b: number[]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 24;

interface Run {
  top: number;
  bottom: number;
}

/**
 * 한 요일 칸을 위에서 아래로 훑어 색이 칠해진 구간을 찾는다.
 *
 * 칸 하나하나를 도형으로 찾아내는 대신 가로로 훑는다. 에브리타임의 수업 칸은
 * 요일 칸 폭을 꽉 채우므로, 어느 높이가 칸 안인지는 그 줄을 가로질러 보면
 * 바로 안다. 훨씬 싸고, 모서리가 둥글거나 테두리가 있어도 안 흔들린다.
 *
 * 한때 칸 가운데를 지나는 **세로줄 하나만** 봤다. 그러다 글자가 흰 테마에서
 * 무너졌다 — 흰 글자는 `isPaper` 가 바탕으로 세므로, 그 세로줄이 글자를 지날
 * 때마다 칸이 토막 났다. 과목명이 두 줄인 칸일수록 심해서, 살아남은 토막에
 * 과목명이 반쯤 잘려 들어가고 인식기가 그걸 통째로 흘렸다.
 *
 * 그래서 한 줄이 아니라 칸 너비를 여러 자리에서 본다. 글자는 어느 높이에서든
 * 폭의 일부만 차지하므로, 다수결로 물으면 글자에 속지 않는다.
 */
/**
 * 줄에 색이 이만큼(비율) 남아 있으면 칸 안이다.
 *
 * 표본 아홉 자리만 찍어 보다가 무너졌다. 과목명은 칸 너비를 거의 다 채우는데
 * 그 글자가 흰 테마에서는 표본이 죄다 흰 획에 떨어져, 글자가 있는 줄을 통째로
 * 칸 밖으로 세었다. 「기초프로그래밍II」 한 칸이 셋으로 토막 났다.
 *
 * 줄 전체를 훑으면 그럴 일이 없다. 글자가 아무리 넓어도 획 사이에는 칸 색이
 * 남고, 칸과 칸 사이의 틈은 처음부터 끝까지 하얗다.
 */
const PAINTED_ENOUGH = 0.08;
const SCAN_STEP = 2;

const runsInColumn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  left: number,
  right: number,
  minHeight: number,
): Run[] => {
  const from = Math.max(0, Math.round(left));
  const to = Math.min(width, Math.round(right));
  const looked = Math.ceil((to - from) / SCAN_STEP);
  if (looked <= 0) return [];
  const enough = Math.max(2, Math.round(looked * PAINTED_ENOUGH));

  const runs: Run[] = [];
  let start = -1;
  let colour: number[] | null = null;
  /** 색이 바뀐 자리와 그 색, 그 색이 몇 줄째 이어지는지. */
  let turn: { y: number; colour: number[]; rows: number } | null = null;

  const close = (end: number) => {
    if (start >= 0 && end - start >= minHeight)
      runs.push({ top: start, bottom: end });
    start = -1;
    colour = null;
    turn = null;
  };

  /*
   * 색이 바뀌어도 이만큼 이어져야 다른 수업으로 본다.
   *
   * 과목명이 칸 너비를 거의 채우면, 흰 획이 가로로 지나는 한두 줄에서는 남은
   * 픽셀 대부분이 획 가장자리의 옅은 색이라 가운뎃값이 확 밝아진다. 그 한 줄을
   * 칸 경계로 읽어 「기초프로그래밍II」 위 토막이 떨어져 나가고 9시 수업이 10시로
   * 들어왔다. 두 칸 걸러 보는 자리가 한 픽셀만 달라도 나고 안 나고가 갈렸다.
   * 글자 획은 몇 줄뿐이고 맞붙은 수업은 적어도 반 교시라, 그 사이에 문턱을 둔다.
   */
  const hold = Math.max(3, Math.floor(minHeight / 4));

  const channel: number[][] = [[], [], []];
  for (let y = 0; y < height; y += 1) {
    channel[0].length = 0;
    channel[1].length = 0;
    channel[2].length = 0;
    for (let x = from; x < to; x += SCAN_STEP) {
      const i = (y * width + x) * 4;
      if (isPaper(data[i], data[i + 1], data[i + 2])) continue;
      channel[0].push(data[i]);
      channel[1].push(data[i + 1]);
      channel[2].push(data[i + 2]);
    }

    if (channel[0].length < enough) {
      /* 틈 바로 앞에서 색이 바뀌던 줄은 칸 가장자리다. 칸에 넣지 않는다. */
      close(turn ? turn.y : y);
      continue;
    }

    /*
     * 그 줄의 대표색은 색이 남은 픽셀들의 가운뎃값으로 잡는다.
     *
     * 예전에는 '어두우면 글자' 로 걸러 냈는데, 그 잣대는 글자가 어두운 테마에만
     * 맞았다. 칸 색 자체가 중간 톤이면 칸 색이 글자로 걸러져 대표색이 아예 안
     * 잡혔다. 가운뎃값은 글자가 검든 희든 상관없다 — 어느 쪽이든 소수다.
     */
    const here = [median(channel[0]), median(channel[1]), median(channel[2])];

    if (start < 0) {
      start = y;
      colour = here;
      continue;
    }
    /* 색이 확 바뀌어 이어지면 다른 수업이 맞붙은 것이다. 사이에 흰 틈이 없을 수 있다. */
    if (!colour || !differs(colour, here)) {
      turn = null;
      continue;
    }
    if (turn && !differs(turn.colour, here)) turn.rows += 1;
    else turn = { y, colour: here, rows: 1 };
    if (turn.rows >= hold) {
      const next = turn;
      close(next.y);
      start = next.y;
      colour = next.colour;
    }
  }
  close(turn ? turn.y : height);
  return runs;
};

/**
 * 세로 자리를 시각으로 옮기는 자.
 *
 * 왼쪽에 적힌 '9시·10시…' 를 글자로 읽되, 전부 읽힐 거라고 믿지 않는다 —
 * 실제로 `11시` 가 `기시` 로, `12시` 가 `1241` 로 읽히는 걸 봤다. 잘 읽힌 것만
 * 골라 직선을 맞춘다. 두 개만 성해도 자가 선다.
 */
export interface TimeAxis {
  /** y = originY 일 때의 분. */
  originMinutes: number;
  /** 1픽셀이 몇 분인지. */
  minutesPerPixel: number;
  originY: number;
}

export const fitTimeAxis = (
  marks: { hour: number; y: number }[],
): TimeAxis | null => {
  if (marks.length < 2) return null;

  /* 가장 멀리 떨어진 두 점을 쓴다. 지렛대가 길수록 눈금이 정확하다. */
  const sorted = [...marks].sort((a, b) => a.y - b.y);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (last.y === first.y || last.hour === first.hour) return null;

  const minutesPerPixel = ((last.hour - first.hour) * 60) / (last.y - first.y);
  /* 한 시간 칸이 20~200px 을 벗어나면 시간표를 잘못 읽은 것이다. */
  const pitch = 60 / minutesPerPixel;
  if (pitch < 20 || pitch > 200) return null;

  /*
   * 라벨이 가리키는 자리와 그 시각이 시작하는 자리는 다르다.
   *
   * `9시` 는 9시 칸 **가운데**에 놓이지만, 9시에 시작하는 수업은 칸 **위**에서
   * 시작한다. 라벨 자리를 그대로 9시로 읽으면 시간표 전체가 반 칸(30분) 밀린다.
   * 그래서 기준을 반 칸 위로 올린다.
   *
   * 이걸 '30분 빼기' 로 뭉뚱그리면 안 된다. 칸 하나가 한 시간이 아닌 시간표에서
   * 또 어긋난다. 반 칸은 눈금에서 바로 나온다.
   */
  return {
    originMinutes: first.hour * 60,
    originY: first.y - pitch / 2,
    minutesPerPixel,
  };
};

export const minutesAt = (axis: TimeAxis, y: number): number =>
  axis.originMinutes + (y - axis.originY) * axis.minutesPerPixel;

/* ── 눈금 고르기 ──────────────────────────────────────────────────────── */

export interface HourMark {
  hour: number;
  y: number;
}

/** 자에서 이만큼 넘게 벗어난 눈금은 잘못 읽은 것으로 본다. */
const OFF_THE_RULER = 30;

/**
 * 가운뎃값 기울기로 자를 세우고, 거기서 벗어난 눈금을 뺀다.
 *
 * 두 점만으로 자를 세우면 그 둘 중 하나가 잘못 읽힌 순간 표 전체가 어긋난다.
 * 실제로 `16시` 가 `봅` 으로, `11시` 가 `기시` 로 읽히는 걸 봤다. 모든 짝의
 * 기울기를 구해 그 가운뎃값을 쓰면, 절반 넘게 성한 한 틀리지 않는다.
 */
const onTheRuler = (marks: HourMark[]): HourMark[] => {
  const slopes: number[] = [];
  for (let i = 0; i < marks.length; i += 1)
    for (let j = i + 1; j < marks.length; j += 1) {
      const dy = marks[j].y - marks[i].y;
      if (dy === 0) continue;
      slopes.push(((marks[j].hour - marks[i].hour) * HOUR) / dy);
    }
  if (slopes.length === 0) return [];

  /*
   * 아래로 갈수록 시각이 커지지 않으면 자가 아니다. 빈손으로 돌려준다.
   *
   * 한때 이 자리에서 눈금을 그대로 돌려줬는데, 그러면 12시간제를 펴지 않은
   * 가설이 「하나도 안 버렸으니 가장 잘 맞는다」로 둔갑해 늘 이겼다. 못 세운
   * 자는 아무것도 얹지 못한 자로 쳐야 위에서 제대로 고른다.
   */
  const minutesPerPixel = median(slopes);
  if (!Number.isFinite(minutesPerPixel) || minutesPerPixel <= 0) return [];

  const base = median(marks.map((m) => m.hour * HOUR - m.y * minutesPerPixel));
  return marks.filter(
    (m) =>
      Math.abs(m.hour * HOUR - (base + m.y * minutesPerPixel)) <= OFF_THE_RULER,
  );
};

const HALF_DAY = 12;
const LAST_HOUR = 23;

/**
 * 12시간제로 적힌 눈금을 편다.
 *
 * 어떤 시간표는 왼쪽에 `9 10 11 12 1 2 3 4` 라고만 적는다. 아래로 갈수록
 * 시각이 커진다고 보고 그대로 읽으면 12 다음의 1 에서 기울기가 뒤집혀,
 * 자가 아예 안 서고 표를 통째로 못 읽는다.
 *
 * 정오는 하루에 한 번뿐이므로 넘어가는 자리도 하나다. 그 자리를 위에서부터
 * 하나씩 옮겨 보며, 자에 가장 많이 얹히는 것을 고른다. 안 옮기는 쪽(24시간제)
 * 부터 보므로, 굳이 오후로 읽지 않아도 되는 표는 건드리지 않는다.
 */
export const readHourMarks = (marks: HourMark[]): HourMark[] => {
  const sorted = [...marks].sort((a, b) => a.y - b.y);
  let best: HourMark[] = [];

  for (let noon = sorted.length; noon >= 0; noon -= 1) {
    const guess = sorted.map((m, i) =>
      i >= noon ? { hour: m.hour + HALF_DAY, y: m.y } : m,
    );
    if (guess.some((m) => m.hour > LAST_HOUR)) continue;

    const kept = onTheRuler(guess);
    if (kept.length > best.length) best = kept;
  }
  return best;
};

/**
 * 자를 수업 칸의 위쪽 경계에 맞춰 다시 재운다.
 *
 * `fitTimeAxis` 는 눈금 라벨이 칸 **가운데** 놓인다고 보고 기준을 반 칸 올린다.
 * 에브리타임 기본 테마는 그렇지만, 라벨을 칸 **위**에 붙이는 테마도 있다.
 * 그런 그림에서는 그 보정이 되레 표 전체를 30분 밀어 버린다.
 *
 * 어느 쪽인지는 그림에 이미 적혀 있다 — 수업 칸의 위쪽 경계다. 자가 맞으면
 * 그 자리들이 정각에 떨어지고, 반 칸 밀렸으면 죄다 30분에 떨어진다. 그래서
 * 라벨의 생김새를 헤아리는 대신 칸들에게 물어본다.
 *
 * 칸이 적거나 반이 안 모이면 손대지 않는다. 수업이 30분에 시작하는 표도
 * 있어서, 어중간한 근거로 옮기면 맞던 것까지 틀린다.
 */
const ALIGN_TOLERANCE = 8;
const ALIGN_QUORUM = 0.6;

export const alignToBlocks = (axis: TimeAxis, tops: number[]): TimeAxis => {
  if (tops.length < 3) return axis;

  const off = tops.map((y) => {
    const rest = minutesAt(axis, y) % HOUR;
    return rest < 0 ? rest + HOUR : rest;
  });
  const agree = (shift: number) =>
    off.filter((o) => {
      const gap = Math.abs(o - shift);
      return Math.min(gap, HOUR - gap) <= ALIGN_TOLERANCE;
    }).length;

  const stay = agree(0);
  const move = agree(HOUR / 2);
  if (move <= stay || move < Math.ceil(tops.length * ALIGN_QUORUM)) return axis;

  return { ...axis, originMinutes: axis.originMinutes - HOUR / 2 };
};

/**
 * 정각으로 맞춘다.
 *
 * 수업은 교시로 돌아간다 — 1교시 9시, 6교시 14시. 그림에서 잰 값은 몇 분씩
 * 어긋나기 마련인데, 실제 시각이 늘 정각이라는 걸 알고 있으니 그 잔떨림을
 * 들고 다닐 이유가 없다. 08:47 이든 09:12 든 답은 09:00 이다.
 */
export const HOUR = 60;

export const snap = (minutes: number, step = HOUR): number =>
  Math.round(minutes / step) * step;

export { runsInColumn, isPaper, isGlyph };

/* ── 글자 읽기 ────────────────────────────────────────────────────────── */

interface Word {
  text: string;
  confidence: number;
  x: number;
  y: number;
  right: number;
  bottom: number;
}

/**
 * 인식기 부속의 자리.
 *
 * 우리 쪽에서 내보낸다(`scripts/copy-ocr.mjs`). 남의 CDN 을 그대로 두면 아예
 * 안 돈다 — 브라우저는 다른 출처의 스크립트로 Worker 를 못 만들어서, 진행률
 * 콜백조차 안 불린 채 조용히 멈춰 있었다. 우리 쪽에 두면 그 문제도 없고,
 * 신호가 죽어도 서비스 워커가 들고 있던 것으로 돈다.
 */
const OCR_ASSETS = {
  workerPath: '/ocr/worker.min.js',
  corePath: '/ocr',
  langPath: '/ocr',
} as const;

/**
 * 한국어 하나만 싣는다.
 *
 * 영어까지 실으면 13MB 가 더 붙는데, 재 보니 한국어만으로 요일·시각·강의실이
 * 다 읽힌다. 칸을 떼어 키워 넘기면 하이픈까지 그대로 온다. 그래도 작은 그림에서
 * `7-615` 가 `7615` 로 오는 일은 남는데, 그건 `room.ts` 의 되살리기가 잡는다.
 */
const OCR_LANGS = ['kor'];

/**
 * 막혔을 때만 부르는 두 번째 인식기.
 *
 * 강의실 코드는 숫자와 하이픈뿐이고 숫자는 라틴 글자다. 그런데 한국어 모델은
 * 손글씨 테마의 숫자에서 곧잘 앞자리를 흘린다 — `7-615` 가 `-615` 로,
 * `43-402` 가 `3-402` 로 온다. 하필 그 앞자리가 건물 번호다.
 *
 * 영어 모델은 그 자리를 더 잘 읽는다. 다만 통째로 바꾸면 안 된다 — 두 모델은
 * **서로 다른 글꼴에서 무너진다**. 손글씨 11종으로 재 보니 한국어 모델이
 * 놓치는 것을 영어 모델이 잡고, 그 반대도 그만큼 있었다. 둘을 한 인식기로
 * 합쳐도 마찬가지였다(어떤 글꼴은 9/11 에서 3/11 으로 떨어졌다).
 *
 * 그래서 섞지 않고 순서를 둔다. 한국어로 먼저 읽고, 그 결과가 캠퍼스에 실재하는
 * 건물로 풀리지 않을 때만 그 칸을 영어로 다시 읽는다. 82% 에서 89% 가 됐고
 * 뒷걸음질한 글꼴은 없었다.
 */
const FALLBACK_LANGS = ['eng'];

interface Reader {
  read: (canvas: HTMLCanvasElement) => Promise<Word[]>;
  close: () => Promise<void>;
}

/**
 * 글자 인식기는 쓸 때만 불러오고, 한 번 세워 여러 번 쓴다.
 *
 * 4MB 가까이 되는 짐이라 첫 화면에 끼워 두면 안 된다. 시간표를 올리는 사람만,
 * 올리는 그 순간에 받는다. 한 번 받으면 브라우저가 들고 있는다.
 *
 * 세우고 무너뜨리는 일이 읽는 일보다 비싸다. 아래에서 그림 한 장을 수십 번
 * 나눠 읽으므로, 인식기를 밖에 두고 돌려 쓴다.
 *
 * 읽는 동안의 진행률은 여기서 넘기지 않는다. 조각마다 0% 로 되감겨서, 그대로
 * 내보내면 화면의 숫자가 왔다 갔다 한다. 몇 조각 중 몇째인지는 부르는 쪽이
 * 알고 있으니 그쪽이 말한다. 여기서는 부속 내려받는 소식만 넘긴다.
 */
const openReader = async (
  langs: string[],
  onProgress?: (ratio: number, what: string) => void,
): Promise<Reader> => {
  /*
   * tesseract 는 CommonJS 라, 번들러를 거치면 알맹이가 default 밑으로 들어간다.
   * 둘 다 받아 준다 — 한쪽만 보고 있다가는 조용히 멈춘다.
   */
  const mod = await import('tesseract.js');
  const createWorker =
    mod.createWorker ??
    (mod as unknown as { default: typeof mod }).default.createWorker;

  const worker = await createWorker(langs, 1, {
    ...OCR_ASSETS,
    logger: (m: { status: string; progress: number }) => {
      if (m.status !== 'recognizing text') onProgress?.(m.progress, m.status);
    },
  });

  const read = async (canvas: HTMLCanvasElement): Promise<Word[]> => {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words: Word[] = [];
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs ?? [])
        for (const line of para.lines ?? [])
          for (const word of line.words ?? [])
            words.push({
              text: word.text.trim(),
              confidence: word.confidence,
              x: word.bbox.x0,
              y: word.bbox.y0,
              right: word.bbox.x1,
              bottom: word.bbox.y1,
            });
    return words;
  };

  return {
    read,
    close: async () => {
      await worker.terminate();
    },
  };
};

const DAY_HEADS = ['월', '화', '수', '목', '금'];

/**
 * 수업 칸 하나를 따로 떼어 그린다.
 *
 * 인식기에 한 칸씩 건네려고 만든다. 왜 나눠 주는지는 `parseTimetableImage` 에 적었다.
 *
 * 두 가지를 같이 한다. 하나는 키우기 — 에브리타임이 내보낸 그림에서 강의실
 * 글자는 15px 밖에 안 되는데, 인식기는 그 두 배는 되어야 제대로 읽는다.
 * 칸 너비를 재서 필요한 만큼만 키운다. 이미 큰 그림을 또 키워 봐야 느리기만
 * 하다.
 *
 * 둘은 흰 여백 두르기 — 글자가 조각 가장자리에 닿아 있으면 인식기가 통째로
 * 흘린다. 옆 칸 세로줄도 이 여백에 밀려 함께 빠진다.
 */
const CROP_WIDTH = 360;
const CROP_MARGIN = 16;
/** 칸 양옆의 세로 눈금선은 빼고 자른다. 글자로 읽힌다. */
const CROP_INSET = 2;

const cropBlock = (
  source: HTMLCanvasElement,
  left: number,
  top: number,
  right: number,
  bottom: number,
): HTMLCanvasElement | null => {
  const x = Math.max(0, Math.round(left) + CROP_INSET);
  const y = Math.max(0, Math.round(top));
  const width = Math.min(source.width, Math.round(right) - CROP_INSET) - x;
  const height = Math.min(source.height, Math.round(bottom)) - y;
  if (width < 1 || height < 1) return null;

  const scale = Math.min(4, Math.max(1, CROP_WIDTH / width));
  const crop = document.createElement('canvas');
  crop.width = Math.round(width * scale) + CROP_MARGIN * 2;
  crop.height = Math.round(height * scale) + CROP_MARGIN * 2;

  const ctx = crop.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    source,
    x,
    y,
    width,
    height,
    CROP_MARGIN,
    CROP_MARGIN,
    crop.width - CROP_MARGIN * 2,
    crop.height - CROP_MARGIN * 2,
  );
  return crop;
};

/**
 * 칸 안에서 글자가 실제로 놓인 세로 구간을 찾는다.
 *
 * 두 시간짜리 수업 칸은 길쭉한데 글자는 맨 위 몇 줄뿐이다. 그 빈 바닥까지
 * 통째로 인식기에 넘기면, 넓은 여백 한가운데 글자가 섬처럼 떠 있는 꼴이 되어
 * 판면 분석이 그 섬을 아예 못 본다 — 손글씨 테마에서 두 시간짜리 칸 셋이
 * 나란히 빈칸으로 나왔다. 글자가 끝나는 데서 잘라 주면 그 셋이 다 살아난다.
 *
 * 바탕색은 칸 곳곳에서 뽑아 가운뎃값으로 정한다. 한 점만 찍어 보면 하필 글자
 * 위를 찍는 수가 있다.
 */
const CONTENT_PAD = 6;

const contentRows = (
  data: Uint8ClampedArray,
  width: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): { first: number; last: number } | null => {
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  const sample: number[][] = [];
  for (
    let y = top;
    y < bottom;
    y += Math.max(1, Math.floor((bottom - top) / 12))
  )
    for (
      let x = left;
      x < right;
      x += Math.max(1, Math.floor((right - left) / 6))
    )
      sample.push(at(x, y));
  if (sample.length === 0) return null;
  const paper = [0, 1, 2].map((c) => median(sample.map((p) => p[c])));

  let first = -1;
  let last = -1;
  for (let y = top; y < bottom; y += 1) {
    let seen = 0;
    for (let x = left; x < right; x += 2) {
      if (!differs(paper, at(x, y))) continue;
      seen += 1;
      if (seen >= 2) break;
    }
    if (seen < 2) continue;
    if (first < 0) first = y;
    last = y;
  }
  return first < 0 ? null : { first, last };
};

/**
 * 왼쪽 시각 눈금 띠를 떼어 낸다.
 *
 * 칸에 쓴 방법을 눈금에도 그대로 쓴다. 그림을 통째로 넘기면 시각 라벨이
 * 형편없이 읽힌다 — 손글씨 테마에서 여덟 중 둘만 살았고(`9`가 `태`로,
 * `11`이 `"`로), 그 둘로 세운 자는 표 전체를 엉뚱한 시각으로 옮겨 놨다.
 * 띠만 떼어 키워 넘기면 같은 그림에서 여섯이 살고, 기본 테마는 여덟 전부가
 * 산다.
 */
const GUTTER_WIDTH = 150;

const cropGutter = (
  source: HTMLCanvasElement,
  right: number,
): { canvas: HTMLCanvasElement; scale: number } | null => {
  const width = Math.round(right);
  if (width < 8) return null;

  const scale = Math.min(3, Math.max(1, GUTTER_WIDTH / width));
  const crop = document.createElement('canvas');
  crop.width = Math.round(width * scale) + CROP_MARGIN * 2;
  crop.height = Math.round(source.height * scale) + CROP_MARGIN * 2;

  const ctx = crop.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    source,
    0,
    0,
    width,
    source.height,
    CROP_MARGIN,
    CROP_MARGIN,
    crop.width - CROP_MARGIN * 2,
    crop.height - CROP_MARGIN * 2,
  );
  return { canvas: crop, scale };
};

/**
 * 잘라 낸 칸 하나에서 강의실을 고른다.
 *
 * 칸 안에 강의실처럼 생긴 낱말이 여럿일 수 있다. 과목명이나 교수 이름이 뭉개져
 * 숫자로 읽히면 그게 먼저 걸린다 — `ICT융합개론` 은 늘 `107` 로 온다. 그래서
 * 먼저 온 것을 집지 않고, **캠퍼스에 실제로 있는 건물 번호로 풀리는 것**을
 * 고른다. 그런 게 여럿이면 아래쪽을 고른다 — 강의실은 칸의 마지막 줄에 적힌다.
 */
interface RoomRead {
  room: string;
  confidence: number;
  /** 캠퍼스에 실재하는 건물로 풀렸는지. 두 번째 인식기를 부를지 정하는 값이다. */
  resolved: boolean;
}

const roomInBlock = (words: Word[], knownBuildings: Set<number>): RoomRead => {
  const candidates = words.filter((w) => looksLikeRoomCode(w.text));
  const resolves = (w: Word) => {
    const no = buildingNoOf(repairRoom(w.text, knownBuildings));
    return no !== null && knownBuildings.has(no);
  };
  const good = candidates.filter(resolves);
  const pool = good.length > 0 ? good : candidates;
  const pick = pool.reduce<Word | undefined>(
    (best, w) => (!best || w.bottom > best.bottom ? w : best),
    undefined,
  );
  return pick
    ? {
        room: repairRoom(pick.text, knownBuildings),
        confidence: pick.confidence,
        resolved: good.includes(pick),
      }
    : { room: '', confidence: 0, resolved: false };
};

/**
 * 그림에서 격자를 읽어 낸다 — 요일 칸이 어디고, 세로 어디가 몇 시인지.
 *
 * 사람이 알아야 할 만큼 잘못됐으면 할 말을 글로 돌려준다.
 */
/**
 * 요일 칸의 가로 자리를 잡는다. 머리글 「월화수목금」이 곧 그 자리다.
 */
const readColumns = (
  canvas: HTMLCanvasElement,
  words: Word[],
): { columns: number[]; pitch: number } | string => {
  const heads = DAY_HEADS.map((label) => {
    const hit = words.find(
      (w) => w.text === label && w.y < canvas.height * 0.15,
    );
    return hit ? (hit.x + hit.right) / 2 : null;
  });
  if (heads.filter((x) => x !== null).length < 2)
    return '요일 줄을 못 찾았습니다. 시간표 전체가 나온 그림인지 확인해 주세요.';

  /* 못 읽은 요일은 읽힌 것들의 간격으로 메운다. 칸 너비는 일정하다. */
  const firstIndex = heads.findIndex((x) => x !== null);
  const lastIndex =
    heads.length - 1 - [...heads].reverse().findIndex((x) => x !== null);
  const pitch =
    (heads[lastIndex]! - heads[firstIndex]!) / (lastIndex - firstIndex);
  const columns = heads.map((x, i) =>
    x !== null ? x : heads[firstIndex]! + (i - firstIndex) * pitch,
  );
  return { columns, pitch };
};

/** 시각 눈금처럼 생긴 낱말. `9`, `9시`, `13` 을 받는다. */
const HOUR_LIKE = /^(\d{1,2})\s*시?$/;
const SURE_ENOUGH = 60;

const hourMarksIn = (words: Word[], scale: number, top: number): HourMark[] => {
  const marks: HourMark[] = [];
  for (const w of words) {
    const hour = Number(HOUR_LIKE.exec(w.text)?.[1]);
    if (!Number.isFinite(hour) || hour < 0 || hour > LAST_HOUR) continue;
    if (w.confidence < SURE_ENOUGH) continue;
    marks.push({ hour, y: top + (w.y + w.bottom) / 2 / scale });
  }
  return marks;
};

/* ── 전체 ─────────────────────────────────────────────────────────────── */

/**
 * 고른 파일 그대로 받는다.
 *
 * `<img>` 에 실어 `decode()` 를 기다리는 길도 있지만, 그쪽은 사진이 안 오면
 * 영영 안 끝나는 수가 있다 — 실제로 그렇게 멈춰 봤다. `createImageBitmap` 은
 * 못 읽으면 못 읽는다고 바로 말한다.
 */
export const parseTimetableImage = async (
  file: Blob,
  knownBuildings: Set<number>,
  onProgress?: (ratio: number, what: string) => void,
): Promise<ParseResult> => {
  const warnings: string[] = [];

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    return {
      slots: [],
      warnings: ['그림을 못 읽었습니다. PNG 나 JPG 인지 확인해 주세요.'],
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx)
    return { slots: [], warnings: ['이 브라우저에서는 그림을 못 읽습니다.'] };
  ctx.drawImage(image, 0, 0);
  image.close();

  const reader = await openReader(OCR_LANGS, onProgress);

  /*
   * 두 번째 인식기는 막힌 칸이 나올 때까지 아예 만들지 않는다.
   *
   * 3MB 짜리 짐이라, 글꼴이 멀쩡한 사람에게까지 지울 이유가 없다. 손글씨
   * 테마로 재 봤을 때 이쪽이 실제로 도는 칸은 여덟에 하나꼴이었고, 기본
   * 테마에서는 한 칸도 없었다.
   */
  const backup: { reader: Reader | null } = { reader: null };
  const readRoom = async (
    crop: HTMLCanvasElement,
    buildings: Set<number>,
  ): Promise<RoomRead> => {
    const first = roomInBlock(await reader.read(crop), buildings);
    if (first.resolved) return first;

    backup.reader ??= await openReader(FALLBACK_LANGS, onProgress);
    const second = roomInBlock(await backup.reader.read(crop), buildings);
    /* 두 번째도 건물로 못 풀면 첫 번째 것을 그대로 둔다. 확인 화면이 받는다. */
    return second.resolved ? second : first;
  };

  try {
    /*
     * 처음 한 번은 그림 전체를 읽는다. 여기서 얻는 건 격자뿐이다 — 요일 머리글과
     * 왼쪽 시각 눈금. 둘 다 흰 바탕에 놓인 짧은 글자라 이 한 번으로 잘 읽힌다.
     */
    onProgress?.(0, 'recognizing text');
    const page = await reader.read(canvas);

    const grid = readColumns(canvas, page);
    if (typeof grid === 'string') return { slots: [], warnings: [grid] };
    const { columns, pitch } = grid;

    /*
     * 시각 눈금은 왼쪽 띠만 따로 떼어 읽는다. 왜 그러는지는 `cropGutter` 에
     * 적었다. 떼어 내지 못했거나 거기서 두 개도 못 건지면, 통째로 읽은 것에서
     * 주워 쓴다 — 없는 것보다는 낫다.
     */
    const leftEdge = columns[0] - pitch / 2;
    const gutter = cropGutter(canvas, leftEdge);
    const fromStrip = gutter
      ? hourMarksIn(
          await reader.read(gutter.canvas),
          gutter.scale,
          -CROP_MARGIN / gutter.scale,
        )
      : [];
    const marks =
      fromStrip.length >= 2
        ? fromStrip
        : hourMarksIn(
            page.filter((w) => w.right <= leftEdge),
            1,
            0,
          );

    const ruler = fitTimeAxis(readHourMarks(marks));
    if (!ruler)
      return {
        slots: [],
        warnings: [
          '왼쪽 시각 눈금을 못 읽었습니다. 시간이 함께 나온 그림이어야 합니다.',
        ],
      };

    /*
     * 흰색만 바탕으로 보게 되면서 한두 픽셀짜리 눈금선까지 걸리는데, 한 교시의
     * 삼분의 일도 안 되는 높이는 수업 칸일 수 없다.
     */
    const minHeight = Math.max(4, Math.round(HOUR / ruler.minutesPerPixel / 3));

    /* 색칠된 칸을 먼저 다 찾아 둔다. 몇 조각인지 알아야 진행률을 말할 수 있다. */
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found: { day: Weekday; centre: number; run: Run }[] = [];
    for (let day = 0; day < 5; day += 1) {
      const centre = Math.round(columns[day]);
      for (const run of runsInColumn(
        data,
        canvas.width,
        canvas.height,
        centre - pitch / 2,
        centre + pitch / 2,
        minHeight,
      )) {
        /* 한 교시의 절반도 안 되는 자국은 칸이 아니라 눈금이나 그림자다. */
        if (minutesAt(ruler, run.bottom) - minutesAt(ruler, run.top) < HOUR / 2)
          continue;
        found.push({ day: day as Weekday, centre, run });
      }
    }

    /* 칸을 다 찾았으니, 이제 그 위쪽 경계에 자를 맞춰 재운다. */
    const axis = alignToBlocks(
      ruler,
      found.map(({ run }) => run.top),
    );

    /*
     * 강의실은 칸을 하나씩 떼어 읽는다.
     *
     * 한 장을 통째로 넘기던 때는 열에 아홉을 놓쳤다. 인식기의 판면 분석이
     * 색칠된 격자를 문서로 못 보기 때문이다 — 재 보니 `ICT융합개론` 칸이
     * 통째로 확신 0 짜리 낱말 하나로 뭉개져 나왔다. 자리를 이미 알고 있는데
     * 그걸 인식기에게 다시 찾아내라고 시킬 이유가 없다.
     *
     * 960px 짜리 시간표 하나로 재 봤다. 통째로 넘기면 11칸 중 2칸, 그나마
     * 하이픈이 빠진 `7615`. 칸마다 떼어 키워 넘기면 11칸 전부, 확신 88~91 에
     * 하이픈까지 그대로. 조각이 작아 열한 번 읽는 데 270ms 면 된다.
     */
    const slots: ParsedSlot[] = [];
    for (const [i, { day, centre, run }] of found.entries()) {
      onProgress?.((i + 1) / (found.length + 1), 'recognizing text');

      const startMinutes = snap(minutesAt(axis, run.top));

      /* 글자가 있는 데까지만 잘라 넘긴다. 빈 바닥은 인식기를 헷갈리게 한다. */
      const left = Math.max(0, Math.round(centre - pitch / 2));
      const right = Math.min(canvas.width, Math.round(centre + pitch / 2));
      const ink = contentRows(
        data,
        canvas.width,
        left,
        right,
        run.top,
        run.bottom,
      );
      const crop = cropBlock(
        canvas,
        centre - pitch / 2,
        ink ? Math.max(run.top, ink.first - CONTENT_PAD) : run.top,
        centre + pitch / 2,
        ink ? Math.min(run.bottom, ink.last + CONTENT_PAD) : run.bottom,
      );
      slots.push({
        day,
        startMinutes,
        /* 정각으로 맞추다 보면 한 교시짜리가 0분으로 눌린다. 최소 한 시간은 준다. */
        endMinutes: Math.max(
          snap(minutesAt(axis, run.bottom)),
          startMinutes + HOUR,
        ),
        ...(crop
          ? await readRoom(crop, knownBuildings)
          : { room: '', confidence: 0 }),
      });
    }
    onProgress?.(1, 'recognizing text');

    /*
     * 못 읽은 칸이 몇인지는 여기서 말하지 않는다.
     *
     * 확인 화면이 지금 값을 보고 세고 있어서, 사람이 고친 뒤에도 여기서 만든 말이
     * 남아 있으면 '고쳤는데 아직 못 읽었다' 는 거짓말이 된다. 그 몫은 화면에
     * 맡기고, 여기서는 그림 자체가 잘못됐을 때만 말한다.
     */
    if (slots.length === 0)
      warnings.push(
        '수업 칸을 하나도 못 찾았습니다. 잘리지 않은 시간표 그림인지 확인해 주세요.',
      );

    return { slots, warnings };
  } finally {
    await reader.close();
    await backup.reader?.close();
  }
};
