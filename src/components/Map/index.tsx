import { useEffect, useRef, useState, type RefObject } from 'react';
import maplibregl, {
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type LineLayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { CampusEdge, CampusNode, LatLng } from '@/types/campus';
import type { CampusGraph } from '@/routing/graph';
import type { Route } from '@/routing/route';
import type { RouteProgress } from '@/routing/progress';
import { boundsOf } from '@/routing/geo';
import {
  CAMPUS_CENTER,
  CAMPUS_ZOOM,
  EDGE_KINDS,
  EDGE_STYLES,
  EDITING_EDGE,
  FIT_MAX_ZOOM,
  MAP_STYLE_URL,
  MAX_ZOOM,
  SELECTED_EDGE_COLOR,
  accuracyStyle,
  compareStyle,
  edgeKind,
  passedStyle,
  routeCasingStyle,
  routeStyle,
  shortcutOverlayStyle,
  type LineStyle,
} from '@/map/mapStyle';
import { endpointIcon, hereIcon, junctionIcon, placeIcon } from '@/map/icons';
import { splitBuildingLabels, type BuildingLabel } from '@/map/buildingLabels';
import type { SheetState } from '@/components/RoutePanel';
import { theme } from '@/styles';
import * as s from './style.css';

interface Props {
  graph: CampusGraph;
  route: Route | null;
  /** 같이 겹쳐 보여 줄 다른 기준의 경로. 같은 길이면 넘기지 않는다. */
  compare: Route | null;
  fromId: string | null;
  toId: string | null;
  here: LatLng | null;
  /** 현위치의 오차 반경(m). 점 대신 '이 안쪽' 을 그려 준다. */
  accuracy: number | null;
  /** 걷는 중이면 어디까지 왔는지. 지나온 구간을 눌러 그린다. */
  progress: RouteProgress | null;
  /**
   * 지도를 덮는 길찾기 패널. 캠퍼스를 보이는 자리에 맞추려고 크기를 재 간다.
   * 잰 값을 상태로 들고 돌면 순서가 꼬여서, 맞출 때 그 자리에서 읽는다.
   */
  panelRef: RefObject<HTMLElement | null>;
  /**
   * 패널이 지도의 어느 쪽을 물고 있는지.
   *
   * 폭만 보고 짐작할 수 없다 — 가로로 돌린 폰은 폭이 850px 이라 넓은 화면처럼
   * 보이지만, 패널은 아래가 아니라 왼쪽 기둥으로 서 있다. 화면 모양을 아는
   * 쪽(App)이 알려 준다.
   */
  panelAt: 'left' | 'bottom';
  /** 시트가 접히고 펴지면 지도에 남는 자리가 달라진다. 그때 다시 맞춘다. */
  sheet: SheetState;
  /** 안내 중. 지도가 현위치를 계속 따라간다. */
  follow: boolean;
  /** 지도에서 곳을 고르는 중. 어느 곳이든 누를 수 있게 캠퍼스 전체를 맞춘다. */
  picking: boolean;
  editing: boolean;
  selectedId: string | null;
  onPickNode: (node: CampusNode) => void;
  onPickEdge: (edge: CampusEdge) => void;
  onMoveNode: (id: string, at: LatLng) => void;
  onMapClick: (at: LatLng) => void;
}

/*
 * 배율은 모두 MapLibre 기준이다(Leaflet 보다 하나 작다).
 */

/** 이름표를 보여 줄 최소 배율. */
const LABEL_ZOOM = 16;
/**
 * 길목을 보여 줄 최소 배율. 캠퍼스 전체가 보이는 배율에서 길목 삼백 개를 다
 * 찍으면 지도가 아니라 점 무더기가 된다.
 */
const JUNCTION_ZOOM = 16;

/**
 * 안내를 시작할 때 맞추는 배율.
 *
 * 여기서 한 번만 맞추고, 그 뒤로는 위치만 따라가며 배율은 손대지 않는다. 매번
 * 다시 맞추면 걷는 사람이 손으로 넓혀 본 화면을 몇 초마다 되돌려 놓는 셈이 된다.
 */
const GUIDE_ZOOM = 17;

/** 이보다 작은 오차 반경은 그리지 않는다. 현위치 점이 이미 그만큼을 덮는다. */
const HALO_MIN_METERS = 10;

/** 길을 누를 때 손가락이 조금 빗나가도 잡히게 잡아 주는 여유(px). */
const EDGE_HIT_SLOP = 6;

/*
 * 마커끼리 겹칠 때의 순서. MapLibre 마커는 지도 캔버스와 같은 층에 있어서
 * 음수를 주면 캔버스 밑으로 숨어 버린다. 0 위에서만 고른다.
 *
 * 갈래마다 한 층(Z_TIER 간격)을 주고, 같은 층 안에서는 남쪽(화면 아래)
 * 마커가 위로 온다. 예전 Leaflet 지도의 규칙이다 — 이게 없으면 무거관(25)
 * 점이 바로 위 「무거관 후문」 점에 덮여 안 보인다.
 */
const Z = { junction: 1, place: 2, here: 3, endpoint: 4 } as const;
const Z_TIER = 10_000;

/* ── 지도 레이어 이름 ─────────────────────────────────────────────────── */

const SRC = {
  edges: 'campus-edges',
  compare: 'campus-compare',
  route: 'campus-route',
  passed: 'campus-passed',
  shortcut: 'campus-shortcut',
  halo: 'campus-halo',
  buildingNames: 'campus-building-names',
} as const;

const edgeLayerId = (kind: string) => `campus-edge-${kind}`;
const EDGE_LAYER_IDS = EDGE_KINDS.map(edgeLayerId);

/**
 * 지명은 한글로. 배경 스타일은 영문 이름을 먼저 쓰는데, 캠퍼스 앱에서
 * 「Ulsan University Hospital」보다 「울산대학교병원」이 낫다.
 */
const KOREAN_NAME: ExpressionSpecification = [
  'coalesce',
  ['get', 'name:ko'],
  ['get', 'name'],
];

/**
 * 배경 지도를 못 받았을 때(첫 실행부터 오프라인) 쓰는 빈 바탕.
 * 캠퍼스 길과 경로는 번들에 들어 있으니 이것만 있어도 길찾기는 된다.
 */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': theme.gray[100] },
    },
  ],
};

/* ── 도형 만들기 ─────────────────────────────────────────────────────── */

const toLngLat = (p: LatLng): [number, number] => [p.lng, p.lat];

type Props_ = Record<string, string | number | boolean>;

const lines = (
  items: { points: LatLng[]; props?: Props_ }[],
): FeatureCollection<Geometry, Props_> => ({
  type: 'FeatureCollection',
  features: items
    .filter((item) => item.points.length > 1)
    .map((item): Feature<Geometry, Props_> => ({
      type: 'Feature',
      properties: item.props ?? {},
      geometry: {
        type: 'LineString',
        coordinates: item.points.map(toLngLat),
      },
    })),
});

const EMPTY = lines([]);

const labelPoints = (
  labels: BuildingLabel[],
): FeatureCollection<Geometry, Props_> => ({
  type: 'FeatureCollection',
  features: labels.map((label): Feature<Geometry, Props_> => ({
    type: 'Feature',
    properties: { name: label.name, minor: Boolean(label.minor) },
    geometry: { type: 'Point', coordinates: toLngLat(label) },
  })),
});

/** 땅 위의 원. 미터 단위 반경을 위경도 다각형으로 펼친다. */
const circle = (
  center: LatLng,
  meters: number,
): FeatureCollection<Geometry, Props_> => {
  const steps = 48;
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    ring.push([
      center.lng + dLng * Math.cos(t),
      center.lat + dLat * Math.sin(t),
    ]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  };
};

const linePaint = (style: LineStyle): LineLayerSpecification['paint'] => ({
  'line-color': style.color,
  'line-width': style.width,
  'line-opacity': style.opacity,
  ...(style.dash ? { 'line-dasharray': style.dash } : {}),
});

const LINE_LAYOUT: LineLayerSpecification['layout'] = {
  'line-cap': 'round',
  'line-join': 'round',
};

const setSource = (
  map: maplibregl.Map,
  id: string,
  data: FeatureCollection<Geometry, Props_>,
) => {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
};

/**
 * 캠퍼스 위에 덧그리는 레이어를 깐다. 스타일을 새로 받을 때마다 다 지워지므로
 * 그때마다 다시 부른다. 내용은 비워 두고, 각 이펙트가 채운다.
 */
const addOverlays = (map: maplibregl.Map) => {
  for (const id of Object.values(SRC)) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  }

  const line = (id: string, source: string, style: LineStyle) =>
    map.addLayer({
      id,
      type: 'line',
      source,
      layout: LINE_LAYOUT,
      paint: linePaint(style),
    });

  /*
   * 건물 이름표. 예전 OSM 지도가 건물 위에 써 주던 이름을 되살린다.
   *
   * 맨 밑에 깐다 — 길과 경로가 그 위를 지나가야 한다. 배경 지도의 장소 이름과
   * 같은 결(회색 글자에 흰 테)로 맞추고, 앱 이름표처럼 당겨야 뜬다. 아파트 동
   * 번호는 한 단계 더 당겨야 뜬다.
   *
   * 글자를 그리려면 스타일에 글꼴 주소가 있어야 해서, 대체 바탕(오프라인)에서는
   * 건너뛴다.
   */
  if (map.getStyle().glyphs) {
    const label = (
      id: string,
      minor: boolean,
      minzoom: number,
      size: number,
      color: string,
    ) =>
      map.addLayer({
        id,
        type: 'symbol',
        source: SRC.buildingNames,
        minzoom,
        filter: ['==', ['get', 'minor'], minor],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': size,
          'text-max-width': 7,
          'text-padding': 2,
        },
        paint: {
          'text-color': color,
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
          'text-halo-blur': 0.5,
        },
      });
    label('campus-building-name', false, LABEL_ZOOM, 11.5, '#666666');
    label('campus-building-number', true, LABEL_ZOOM + 1, 10.5, '#8c8c8c');
  }

  /* 아래에 깔리는 것부터. */
  for (const kind of EDGE_KINDS) {
    map.addLayer({
      id: edgeLayerId(kind),
      type: 'line',
      source: SRC.edges,
      filter: ['==', ['get', 'kind'], kind],
      layout: LINE_LAYOUT,
      paint: linePaint(EDGE_STYLES[kind]),
    });
  }
  line('campus-compare', SRC.compare, compareStyle);
  line('campus-route-casing', SRC.route, routeCasingStyle);
  line('campus-route', SRC.route, routeStyle);
  line('campus-passed', SRC.passed, passedStyle);
  line('campus-shortcut', SRC.shortcut, shortcutOverlayStyle);

  map.addLayer({
    id: 'campus-halo-fill',
    type: 'fill',
    source: SRC.halo,
    paint: {
      'fill-color': accuracyStyle.color,
      'fill-opacity': accuracyStyle.fillOpacity,
    },
  });
  map.addLayer({
    id: 'campus-halo-line',
    type: 'line',
    source: SRC.halo,
    paint: {
      'line-color': accuracyStyle.color,
      'line-opacity': accuracyStyle.lineOpacity,
      'line-width': 1,
    },
  });
};

/**
 * 배경 지도를 캠퍼스 앱에 맞게 다듬는다. 지명은 한글로 바꾼다.
 *
 * 장소(정류장·편의점·식당·공원·주차장…) 레이어는 그대로 둔다. 예전 OSM 지도가
 * 보여 주던 곳이라, 끄면 「정류장이 사라졌다」가 된다. 다만 앱 마커와 같은 곳은
 * 이름이 두 번 뜨니 따로 거른다 — 그때 원래 거름 조건 위에 덧붙이려고, 장소
 * 레이어의 원래 조건을 모아 돌려준다.
 */
const tuneBaseStyle = (map: maplibregl.Map) => {
  const layers = map.getStyle().layers ?? [];
  const poiFilters = new Map<string, FilterSpecification | undefined>();
  for (const layer of layers) {
    if (layer.type !== 'symbol' || layer.id.startsWith('campus-')) continue;
    if (layer['source-layer'] === 'poi') poiFilters.set(layer.id, layer.filter);
    const field = layer.layout?.['text-field'];
    /* 도로 번호 방패처럼 이름이 아닌 글자는 그대로 둔다. */
    if (field && JSON.stringify(field).includes('name')) {
      map.setLayoutProperty(layer.id, 'text-field', KOREAN_NAME);
    }
  }

  /*
   * 상가 거리에서는 도로 이름과 가게 이름이 자리를 다툰다. 지도는 위에 있는
   * 레이어부터 글자 자리를 잡는데, 원래 스타일은 도로 이름이 위라 대학로 가게가
   * 한 배율 더 당겨야 떴다. 장소 레이어를 도로 이름 위(동네 이름 바로 밑)로
   * 올려 예전 OSM 지도와 같은 배율에서 보이게 한다.
   */
  const placeLabel = layers.find(
    (layer) => layer.type === 'symbol' && layer['source-layer'] === 'place',
  );
  if (placeLabel) {
    for (const id of poiFilters.keys()) map.moveLayer(id, placeLabel.id);
  }

  /*
   * 건물은 납작하게 그린다.
   *
   * 원래 스타일은 건물을 높이만큼 세운다(3D). 이 앱은 지도를 안 기울이지만,
   * 원근 때문에 높은 건물은 옥상이 화면 가장자리 쪽으로 밀려 그려진다. 10층인
   * 국제관 옥상이 12m 뒤의 무거관을 덮어서 두 건물이 한 덩어리로 보였다. 마커는
   * 건물 자리에 찍히는데 옥상은 옆으로 비켜 있으니 길 찾을 때도 헷갈린다.
   *
   * 세운 건물은 끄고, 낮은 배율에만 쓰던 납작한 건물 레이어를 모든 배율로
   * 늘린다. 예전 OSM 지도와 같은 모양이다. 납작한 레이어가 없는 스타일이면
   * 건물이 통째로 사라지니 그때는 손대지 않는다.
   */
  const flat = layers.find(
    (layer) => layer.type === 'fill' && layer['source-layer'] === 'building',
  );
  if (flat) {
    for (const layer of layers) {
      if (
        layer.type === 'fill-extrusion' &&
        layer['source-layer'] === 'building'
      )
        map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
    map.setLayerZoomRange(flat.id, flat.minzoom ?? 0, 24);
  }

  return poiFilters;
};

/** 화면 가장자리에서 안쪽으로 inset 비율만큼 들어온 상자 안에 있는지. */
const isWellInView = (map: maplibregl.Map, p: LatLng, inset = 0.15) => {
  const b = map.getBounds();
  const w = b.getEast() - b.getWest();
  const h = b.getNorth() - b.getSouth();
  return (
    p.lng > b.getWest() + w * inset &&
    p.lng < b.getEast() - w * inset &&
    p.lat > b.getSouth() + h * inset &&
    p.lat < b.getNorth() - h * inset
  );
};

/**
 * 지도를 만든다. 못 만들면 null.
 *
 * MapLibre 는 WebGL 로 그린다. WebGL 을 못 쓰는 브라우저(아주 오래된 기기,
 * 하드웨어 가속을 끈 경우)에서는 생성자가 예외를 던지는데, 그게 그대로 터지면
 * 길찾기 패널까지 앱 전체가 하얗게 죽는다. 지도 자리만 비워 두고 나머지는
 * 그대로 돌게 한다.
 *
 * 돌리기와 기울이기는 막는다. 캠퍼스 안내 지도는 북쪽이 위로 고정돼 있어야
 * 「오른쪽으로 꺾어」 같은 말과 화면이 어긋나지 않는다.
 */
const createMap = (container: HTMLElement): maplibregl.Map | null => {
  try {
    const instance = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      center: toLngLat(CAMPUS_CENTER),
      zoom: CAMPUS_ZOOM,
      maxZoom: MAX_ZOOM,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    return instance;
  } catch (error) {
    console.error('[map] 지도를 만들지 못했습니다.', error);
    return null;
  }
};

const CampusMap = ({
  graph,
  route,
  compare,
  fromId,
  toId,
  here,
  accuracy,
  progress,
  panelRef,
  panelAt,
  sheet,
  follow,
  picking,
  editing,
  selectedId,
  onPickNode,
  onPickEdge,
  onMoveNode,
  onMapClick,
}: Props) => {
  /** 길목을 보여 줄 만큼 당겼는지. 배율 숫자 자체는 매 순간 바뀌어서 이것만 든다. */
  const [near, setNear] = useState(false);
  /**
   * 배경 스타일을 받아 덧그림 레이어를 깐 횟수. 0 이면 아직이다.
   * 스타일을 다시 받으면 레이어가 새로 깔리니, 이 값이 바뀌면 내용을 다시 채운다.
   */
  const [styleRev, setStyleRev] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  /** 지도를 만든 뒤에야 생기는 손잡이. 경로가 정해질 때 다시 부른다. */
  const fitTo = useRef<(points: LatLng[], remember?: boolean) => void>(
    () => {},
  );
  /** 마지막으로 맞춘 대상. 시트가 움직이면 같은 것을 다시 맞춘다. */
  const lastFit = useRef<LatLng[] | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const hereMarker = useRef<maplibregl.Marker | null>(null);
  /** 지도에서 누른 길을 간선으로 되찾으려고 들고 있는 표. */
  const edgesById = useRef(new Map<string, CampusEdge>());
  /** 배경 지도 장소 레이어의 원래 거름 조건. 앱 마커와 겹치는 곳을 거를 때 쓴다. */
  const poiFilters = useRef(new Map<string, FilterSpecification | undefined>());

  /* 콜백은 매 렌더 새로 오지만 지도는 한 번만 만든다. 최신 것만 참조로 들고 간다. */
  const handlers = useRef({ onPickNode, onPickEdge, onMoveNode, onMapClick });
  useEffect(() => {
    handlers.current = { onPickNode, onPickEdge, onMoveNode, onMapClick };
  });

  const nodesRef = useRef(graph.nodes);
  useEffect(() => {
    nodesRef.current = graph.nodes;
  });

  /* 지도를 누른 게 길을 고른 건지는 편집 중일 때만 따진다. */
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  });

  /* 따라가기를 켤 때 최신 위치를 봐야 하는데, 위치마다 다시 돌 필요는 없다. */
  const hereRef = useRef(here);
  useEffect(() => {
    hereRef.current = here;
  });

  /* 맞출 때 시트가 지금 지도를 가리고 있는지 그 자리에서 봐야 한다. */
  const sheetRef = useRef(sheet);
  useEffect(() => {
    sheetRef.current = sheet;
  });

  /* 패널이 옆인지 아래인지도 마찬가지로 맞추는 그 순간에 봐야 한다. */
  const panelAtRef = useRef(panelAt);
  useEffect(() => {
    panelAtRef.current = panelAt;
  });

  /* 따라가는 중에 창이 바뀌면 맞추는 게 아니라 현위치로 되돌려야 한다. */
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  });

  /* ── 지도 만들기 (한 번) ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!holder.current || map.current) return;

    const instance = createMap(holder.current);
    if (!instance) return;

    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'bottom-right',
    );

    /*
     * 배경 스타일이 들어올 때마다(처음, 그리고 대체 바탕으로 바꿨을 때) 덧그림
     * 레이어를 다시 깐다. 'load' 는 처음 한 번뿐이라 'style.load' 를 듣는다.
     */
    let styled = false;
    instance.on('style.load', () => {
      styled = true;
      poiFilters.current = tuneBaseStyle(instance);
      addOverlays(instance);
      setStyleRev((n) => n + 1);
    });

    /*
     * 스타일을 못 받으면 'style.load' 가 영영 안 와서 길도 경로도 안 그려진다.
     * 그때는 빈 바탕으로 갈아 끼운다. 스타일이 들어온 뒤의 오류(타일 한 장)는
     * 지도가 알아서 넘긴다.
     *
     * 여기서 오류를 받아 가면 MapLibre 는 콘솔에 따로 찍지 않는다. 개발 중에는
     * 원인을 볼 수 있게 직접 찍어 둔다.
     */
    let fellBack = false;
    instance.on('error', (event) => {
      if (import.meta.env.DEV) console.warn('[map]', event.error);
      if (styled || fellBack) return;
      fellBack = true;
      instance.setStyle(FALLBACK_STYLE);
    });

    /*
     * 배경 스타일의 아이콘 묶음에 없는 장소 종류가 있다(사무실·체육 시설 등).
     * 이름은 그대로 뜨는데, 그릴 때마다 콘솔에 「그림을 못 찾았다」가 쌓인다.
     * 투명한 한 점으로 채워 둔다.
     */
    instance.on('styleimagemissing', ({ id }) => {
      if (instance.hasImage(id)) return;
      instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    const syncZoomClass = () => {
      const level = instance.getZoom();
      setNear(level >= JUNCTION_ZOOM);
      holder.current?.classList.toggle('campus-map--far', level < LABEL_ZOOM);
    };
    syncZoomClass();
    instance.on('zoomend', syncZoomClass);

    /** 이 화면 좌표 근처에 있는 캠퍼스 길. 편집 중이 아니면 찾지 않는다. */
    const edgeAt = (x: number, y: number) => {
      if (!editingRef.current || !instance.getLayer(EDGE_LAYER_IDS[0])) {
        return undefined;
      }
      const hit = instance.queryRenderedFeatures(
        [
          [x - EDGE_HIT_SLOP, y - EDGE_HIT_SLOP],
          [x + EDGE_HIT_SLOP, y + EDGE_HIT_SLOP],
        ],
        { layers: EDGE_LAYER_IDS },
      );
      const id = hit[0]?.properties?.edgeId;
      return typeof id === 'string' ? edgesById.current.get(id) : undefined;
    };

    instance.on('click', (e) => {
      const edge = edgeAt(e.point.x, e.point.y);
      if (edge) {
        handlers.current.onPickEdge(edge);
        return;
      }
      handlers.current.onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    /* 편집 중에 길 위에 올라가면 누를 수 있다는 걸 손가락 모양으로 알린다. */
    instance.on('mousemove', (e) => {
      if (!editingRef.current) return;
      instance.getCanvas().style.cursor = edgeAt(e.point.x, e.point.y)
        ? 'pointer'
        : '';
    });

    /*
     * 개발 모드에서는 스타일이 자바스크립트로 뒤늦게 붙는다. 그래서 이 시점의
     * 컨테이너는 아직 0×0 일 수 있고, 그대로 fitBounds 를 부르면 엉뚱한
     * 배율로 튄다. 크기가 실제로 잡힌 뒤에 한 번만 맞춘다.
     */
    /*
     * 길찾기 패널이 지도를 덮는다. 세로로 든 폰에선 아래를, 그 밖에는 왼쪽을
     * 가리므로 그만큼 여백을 줘야 캠퍼스가 보이는 자리에 들어온다.
     * 크기를 짐작하면 틀린다 — 패널이 잰 실제 크기를 받아 쓴다.
     */
    const fitPoints = (points: LatLng[], remember = true) => {
      if (remember) lastFit.current = points;
      const box = boundsOf(points);
      const width = holder.current?.clientWidth ?? 0;
      const height = holder.current?.clientHeight ?? 0;
      if (!box || !width || !height) return;

      /*
       * 화면 밖으로 내보낸 시트(기둥)는 아무것도 가리지 않으니 그때는 세지
       * 않는다 — 여기서 잘못 세면 고르기로 들어갈 때 캠퍼스가 한쪽으로 밀려
       * 사라진다.
       */
      const covered = sheetRef.current !== 'hidden';
      const panel = covered ? panelRef.current?.getBoundingClientRect() : null;
      const atBottom = panelAtRef.current === 'bottom';
      const left = !atBottom && panel ? Math.round(panel.width) + 32 : 0;
      const bottom = atBottom && panel ? Math.round(panel.height) : 0;

      /*
       * 여백이 화면을 다 먹으면 fitBounds 가 맞추기를 포기한다. 남길 자리를 지킨다.
       *
       * 남기는 양은 고정 픽셀이 아니라 비율이다. 세로 폰에서 시트를 펼치면
       * 아래가 화면의 3/4 을 물기 때문에, 96px 만 남기면 캠퍼스가 실오라기
       * 같은 띠에 눌려 들어가 한참 축소된 배율로 잡힌다. 절반쯤은 남겨 둔다.
       */
      const cap = (value: number, limit: number) =>
        Math.max(0, Math.min(value, limit * 0.55));

      /* 지도가 들고 있는 크기가 낡아 있으면 배율을 엉뚱하게 고른다. */
      instance.resize();

      /*
       * animate: false 가 꼭 필요하다. 애니메이션이 붙은 fitBounds 는 전환이
       * 끝나야 자리가 잡히는데, 탭이 뒤에 있거나 화면이 멈춘 환경에서는 그
       * 전환이 영영 안 끝나서 지도가 처음 배율에 그대로 머문다.
       */
      instance.fitBounds([toLngLat(box[0]), toLngLat(box[1])], {
        padding: {
          top: 16,
          left: cap(left, width) + 16,
          right: 16,
          bottom: cap(bottom, height) + 16,
        },
        maxZoom: FIT_MAX_ZOOM,
        animate: false,
      });
    };
    fitTo.current = fitPoints;

    const fit = () => fitPoints([...nodesRef.current.values()]);

    /*
     * 맞추는 시점.
     *
     * ResizeObserver 는 환경에 따라 아예 안 불릴 수 있어서 여기에만 기대면
     * 지도가 영영 안 맞는다. 이펙트가 도는 지금 레이아웃은 이미 확정돼 있으니
     * 바로 한 번 맞추고, 스타일이 늦게 붙는 경우를 위해 다음 프레임에 한 번 더
     * 맞춘다. 그 뒤로는 창 크기가 바뀔 때만 손댄다.
     */
    fit();
    const firstFrame = requestAnimationFrame(fit);

    /*
     * 폰을 돌렸을 때.
     *
     * 지도가 들고 있는 크기는 창이 바뀔 때마다 새로 잡아 준다. 다만 보던
     * 자리를 다시 맞추는 것은 가로세로가 뒤집혔을 때뿐이다 — 세로에 맞춰 잡아
     * 둔 배율을 납작한 화면에 그대로 쓰면 캠퍼스가 위아래로 잘린다. 사람이
     * 손으로 넓혀 본 화면은 그대로 둔다.
     */
    const shapeOf = () =>
      (holder.current?.clientWidth ?? 0) >= (holder.current?.clientHeight ?? 0)
        ? 'landscape'
        : 'portrait';

    const refit = () => {
      /* 걷는 중에는 캠퍼스가 아니라 발밑을 봐야 한다. */
      if (followRef.current) {
        const at = hereRef.current;
        if (at) instance.jumpTo({ center: toLngLat(at) });
        return;
      }
      fitPoints(lastFit.current ?? [...nodesRef.current.values()]);
    };

    let shape = shapeOf();
    let settle = 0;

    const onResize = () => {
      instance.resize();
      const now = shapeOf();
      if (now === shape) return;
      shape = now;
      /*
       * 돌린 직후에 읽는 크기는 아직 돌기 전 것일 수 있다(iOS). 지금 한 번
       * 맞추고, 자리가 잡히는 다음 프레임에 한 번 더 맞춘다.
       */
      refit();
      cancelAnimationFrame(settle);
      settle = requestAnimationFrame(refit);
    };
    window.addEventListener('resize', onResize);

    map.current = instance;

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(settle);
      window.removeEventListener('resize', onResize);
      instance.remove();
      map.current = null;
      /* 지도와 함께 사라진 마커를 들고 있으면 다음 지도에 안 붙는다. */
      markers.current = [];
      hereMarker.current = null;
      setStyleRev(0);
    };
  }, [panelRef]);

  /*
   * 시트가 움직이면 지도에 남는 자리가 달라진다. 접거나 내려보내 넓어진 만큼을
   * 써서 다시 맞춰야 캠퍼스가 가운데로 온다. 따라가는 중에는 손대지 않는다 —
   * 걷는 사람 화면이 몇 초마다 튀면 아무것도 못 본다.
   *
   * 고르는 중에는 마지막에 보던 자리가 아니라 캠퍼스 전체를 맞춘다. 어느 곳이든
   * 누를 수 있어야 하는데, 방금 뽑은 경로에 맞춰 놓으면 그 바깥은 손이 안 닿는다.
   * 그 맞춤은 기억해 두지 않는다 — 고르기가 끝나면 원래 보던 자리로 돌아간다.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || follow) return;
    instance.resize();
    const all = [...nodesRef.current.values()];
    if (picking) fitTo.current(all, false);
    else fitTo.current(lastFit.current ?? all);
  }, [sheet, follow, picking, panelAt]);

  /*
   * 안내를 켜면 걷기 좋은 배율로 한 번 당긴다.
   *
   * 켜는 순간이 아니라 '위치가 처음 잡히는 순간' 이다. 당길 자리가 없는데 배율만
   * 올리면 경로가 화면 밖으로 밀려나 아무것도 안 보인다.
   */
  const needsGuideZoom = useRef(false);
  useEffect(() => {
    needsGuideZoom.current = follow;
  }, [follow]);

  /*
   * 출발·도착이 바뀌면 경로가 다 보이도록 맞춘다. 좁은 화면에서는 시트가
   * 커지면서 경로를 통째로 가려 버리기 때문이다. 기준만 바꿀 때는 건드리지
   * 않는다 — 같은 구간을 보는 중에 화면이 튀면 성가시다.
   */
  const legKey = route ? `${route.from.id}→${route.to.id}` : null;
  useEffect(() => {
    if (!map.current || !route || route.points.length < 2) return;
    fitTo.current(route.points);
    /* 경로 자체가 아니라 '어디서 어디로' 가 바뀔 때만 맞춘다. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legKey]);

  /* ── 배경 길 ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleRev) return;

    const byId = new Map<string, CampusEdge>();
    const items: { points: LatLng[]; props: Props_ }[] = [];
    for (const [id, links] of graph.links) {
      for (const link of links) {
        /* 양방향이라 같은 간선이 두 번 나온다. 한쪽만 그린다. */
        if (link.edge.from !== id) continue;
        byId.set(link.edge.id, link.edge);
        items.push({
          points: link.points,
          props: { kind: edgeKind(link.edge), edgeId: link.edge.id },
        });
      }
    }
    edgesById.current = byId;
    setSource(instance, SRC.edges, lines(items));

    /* 편집 중에는 눌러 고르기 좋게 굵고 진하게, 고른 길은 색을 입힌다. */
    for (const kind of EDGE_KINDS) {
      const layer = edgeLayerId(kind);
      const base = EDGE_STYLES[kind];
      instance.setPaintProperty(
        layer,
        'line-width',
        editing ? EDITING_EDGE.width : base.width,
      );
      instance.setPaintProperty(
        layer,
        'line-opacity',
        editing ? EDITING_EDGE.opacity : base.opacity,
      );
      instance.setPaintProperty(
        layer,
        'line-color',
        editing && selectedId
          ? [
              'case',
              ['==', ['get', 'edgeId'], selectedId],
              SELECTED_EDGE_COLOR,
              base.color,
            ]
          : base.color,
      );
    }
    if (!editing) instance.getCanvas().style.cursor = '';
  }, [graph, editing, selectedId, styleRev]);

  /* ── 건물 이름표·배경 장소 ───────────────────────────────────────────── */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleRev) return;

    /*
     * 그래프와 맞대 보고 나눈다. 편집 모드에서 건물을 새로 찍으면 그 건물의
     * 이름표는 거기서 빠지고 앱 마커가 대신한다.
     */
    const { shown, hiddenPoiNames } = splitBuildingLabels(graph.nodes.values());
    setSource(instance, SRC.buildingNames, labelPoints(shown));

    /*
     * 앱 마커와 같은 곳은 배경 장소에서 뺀다. 같은 이름이 마커 옆에 한 번 더
     * 뜨면 어느 쪽을 눌러야 하는지 헷갈린다. 정류장·가게처럼 앱에 없는 곳은
     * 그대로 둔다.
     */
    const notOurs: ExpressionSpecification = [
      '!',
      [
        'in',
        ['coalesce', ['get', 'name:ko'], ['get', 'name'], ''],
        ['literal', hiddenPoiNames],
      ],
    ];
    for (const [id, original] of poiFilters.current) {
      if (!instance.getLayer(id)) continue;
      instance.setFilter(
        id,
        original
          ? (['all', original, notOurs] as FilterSpecification)
          : notOurs,
      );
    }
  }, [graph, styleRev]);

  /* ── 고른 경로 ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleRev) return;

    setSource(
      instance,
      SRC.compare,
      route && compare ? lines([{ points: compare.points }]) : EMPTY,
    );
    setSource(
      instance,
      SRC.route,
      route ? lines([{ points: route.points }]) : EMPTY,
    );

    /* 이미 지나온 만큼은 회색으로 덮는다. 남은 길만 초록으로 남는다. */
    setSource(
      instance,
      SRC.passed,
      route && progress && progress.passed.length > 1
        ? lines([{ points: progress.passed }])
        : EMPTY,
    );

    /* 경로 안의 지름길 구간에만 흰 점선을 덧씌워 눈에 띄게. */
    setSource(
      instance,
      SRC.shortcut,
      route
        ? lines(
            route.legs
              .filter((leg) => leg.link.edge.shortcut)
              .map((leg) => ({ points: leg.link.points })),
          )
        : EMPTY,
    );
  }, [route, compare, progress, styleRev]);

  /* ── 장소 표시 ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    for (const marker of markers.current) marker.remove();
    markers.current = [];

    /* 북쪽부터 세어 남쪽일수록 큰 순번. 같은 층 안에서 이 순서로 포갠다. */
    const southward = new Map(
      [...graph.nodes.values()]
        .sort((a, b) => b.lat - a.lat)
        .map((node, i) => [node.id, i]),
    );

    for (const node of graph.nodes.values()) {
      const isJunction = node.kind === 'junction';
      if (isJunction && (!editing || !near)) continue;

      const endpoint = node.id === fromId || node.id === toId;
      const className = [
        endpoint
          ? node.id === fromId
            ? s.endpoint
            : s.endpointTo
          : isJunction
            ? s.junction
            : node.kind === 'gate'
              ? s.gate
              : node.medical
                ? s.medical
                : s.place,
        node.precision === 'approx' && !endpoint ? s.approx : '',
      ]
        .filter(Boolean)
        .join(' ');

      const icon = endpoint
        ? endpointIcon(node, node.id === fromId ? '출발' : '도착', className)
        : isJunction
          ? junctionIcon(node, className)
          : placeIcon(node, className);

      const tier = endpoint ? Z.endpoint : isJunction ? Z.junction : Z.place;
      icon.root.style.zIndex = String(
        tier * Z_TIER + (southward.get(node.id) ?? 0),
      );

      /* 지도까지 올라가면 '빈 곳을 눌렀다' 로도 읽힌다. 여기서 끊는다. */
      icon.root.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.current.onPickNode(node);
      });

      const marker = new maplibregl.Marker({
        element: icon.root,
        anchor: 'center',
        draggable: editing,
      })
        .setLngLat(toLngLat(node))
        .addTo(instance);

      if (editing) {
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLngLat();
          handlers.current.onMoveNode(node.id, { lat, lng });
        });
      }

      markers.current.push(marker);
    }
  }, [graph, editing, fromId, toId, near]);

  /* ── 현위치 ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    /*
     * 오차 반경은 지도 레이어로, 점은 그 위의 마커로 그린다. 점이 늘 위라
     * 반경에 묻히지 않는다. 반경이 점만큼 작으면 그리지 않는다 — 테두리만
     * 겹쳐 지저분해진다.
     */
    if (styleRev) {
      setSource(
        instance,
        SRC.halo,
        here && accuracy !== null && accuracy > HALO_MIN_METERS
          ? circle(here, accuracy)
          : EMPTY,
      );
    }

    if (!here) {
      hereMarker.current?.remove();
      hereMarker.current = null;
      return;
    }

    if (!hereMarker.current) {
      const icon = hereIcon(s.here);
      icon.root.style.zIndex = String(Z.here * Z_TIER);
      icon.root.style.pointerEvents = 'none';
      hereMarker.current = new maplibregl.Marker({
        element: icon.root,
        anchor: 'center',
      })
        .setLngLat(toLngLat(here))
        .addTo(instance);
    } else {
      hereMarker.current.setLngLat(toLngLat(here));
    }

    /*
     * 안내 중이면 계속 가운데에 둔다. 걸으면서 화면을 손으로 끌 수는 없다.
     * 안내를 안 켰을 때는 정말로 화면을 벗어났을 때만 옮긴다 — 지도를 들여다보는
     * 중에 몇 초마다 끌려가면 아무것도 볼 수 없다.
     */
    if (follow && needsGuideZoom.current) {
      needsGuideZoom.current = false;
      instance.jumpTo({
        center: toLngLat(here),
        zoom: Math.max(instance.getZoom(), GUIDE_ZOOM),
      });
    } else if (follow) {
      instance.jumpTo({ center: toLngLat(here) });
    } else if (!isWellInView(instance, here)) {
      instance.jumpTo({ center: toLngLat(here) });
    }
  }, [here, accuracy, follow, styleRev]);

  return <div ref={holder} className={s.container} />;
};

export default CampusMap;
