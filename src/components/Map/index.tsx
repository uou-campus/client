import { useEffect, useRef, useState, type RefObject } from 'react';
import L from 'leaflet';
import type { CampusEdge, CampusNode, LatLng } from '@/types/campus';
import type { CampusGraph } from '@/routing/graph';
import type { Route } from '@/routing/route';
import type { RouteProgress } from '@/routing/progress';
import { boundsOf } from '@/routing/geo';
import {
  CAMPUS_CENTER,
  CAMPUS_ZOOM,
  TILE_ATTRIBUTION,
  TILE_URL,
  baseEdgeStyle,
  accuracyStyle,
  compareStyle,
  passedStyle,
  routeCasingStyle,
  routeStyle,
  shortcutOverlayStyle,
} from '@/map/mapStyle';
import { endpointIcon, hereIcon, junctionIcon, placeIcon } from '@/map/icons';
import type { SheetState } from '@/components/RoutePanel';
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

/** 이름표를 보여 줄 최소 배율. */
const LABEL_ZOOM = 17;
/**
 * 길목을 보여 줄 최소 배율. 캠퍼스 전체가 보이는 배율에서 길목 삼백 개를 다
 * 찍으면 지도가 아니라 점 무더기가 된다.
 */
const JUNCTION_ZOOM = 17;

/**
 * 안내를 시작할 때 맞추는 배율.
 *
 * 여기서 한 번만 맞추고, 그 뒤로는 위치만 따라가며 배율은 손대지 않는다. 매번
 * 다시 맞추면 걷는 사람이 손으로 넓혀 본 화면을 몇 초마다 되돌려 놓는 셈이 된다.
 */
const GUIDE_ZOOM = 18;

/** 이보다 작은 오차 반경은 그리지 않는다. 현위치 점이 이미 그만큼을 덮는다. */
const HALO_MIN_METERS = 10;

const toLeaflet = (p: LatLng): L.LatLngTuple => [p.lat, p.lng];

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
  const [zoom, setZoom] = useState(CAMPUS_ZOOM);
  const holder = useRef<HTMLDivElement>(null);
  /** 지도를 만든 뒤에야 생기는 손잡이. 경로가 정해질 때 다시 부른다. */
  const fitTo = useRef<(points: LatLng[], remember?: boolean) => void>(
    () => {},
  );
  /** 마지막으로 맞춘 대상. 시트가 움직이면 같은 것을 다시 맞춘다. */
  const lastFit = useRef<LatLng[] | null>(null);
  const map = useRef<L.Map | null>(null);
  const baseLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const hereMarker = useRef<L.Marker | null>(null);
  const hereHalo = useRef<L.Circle | null>(null);

  /* 콜백은 매 렌더 새로 오지만 지도는 한 번만 만든다. 최신 것만 참조로 들고 간다. */
  const handlers = useRef({ onPickNode, onPickEdge, onMoveNode, onMapClick });
  useEffect(() => {
    handlers.current = { onPickNode, onPickEdge, onMoveNode, onMapClick };
  });

  const nodesRef = useRef(graph.nodes);
  useEffect(() => {
    nodesRef.current = graph.nodes;
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

    const instance = L.map(holder.current, {
      center: toLeaflet(CAMPUS_CENTER),
      zoom: CAMPUS_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: TILE_ATTRIBUTION,
    }).addTo(instance);

    L.control.zoom({ position: 'bottomright' }).addTo(instance);

    baseLayer.current = L.layerGroup().addTo(instance);
    routeLayer.current = L.layerGroup().addTo(instance);
    markerLayer.current = L.layerGroup().addTo(instance);

    const syncZoomClass = () => {
      const level = instance.getZoom();
      setZoom(level);
      holder.current?.classList.toggle('campus-map--far', level < LABEL_ZOOM);
    };
    syncZoomClass();
    instance.on('zoomend', syncZoomClass);
    instance.on('click', (e) => handlers.current.onMapClick(e.latlng));

    /*
     * 개발 모드에서는 스타일이 자바스크립트로 뒤늦게 붙는다. 그래서 이 시점의
     * 컨테이너는 아직 0×0 일 수 있고, 그대로 fitBounds 를 부르면 최대 배율로
     * 튄다. 크기가 실제로 잡힌 뒤에 한 번만 맞춘다.
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
       * 여백이 화면을 다 먹으면 fitBounds 가 최대 배율로 튄다. 남길 자리를 지킨다.
       *
       * 남기는 양은 고정 픽셀이 아니라 비율이다. 세로 폰에서 시트를 펼치면
       * 아래가 화면의 3/4 을 물기 때문에, 96px 만 남기면 캠퍼스가 실오라기
       * 같은 띠에 눌려 들어가 한참 축소된 배율로 잡힌다. 절반쯤은 남겨 둔다.
       */
      const cap = (value: number, limit: number) =>
        Math.max(0, Math.min(value, limit * 0.55));

      /* Leaflet 이 들고 있는 크기가 낡아 있으면 배율을 엉뚱하게 고른다. */
      instance.invalidateSize({ animate: false });

      /*
       * animate: false 가 꼭 필요하다. 애니메이션이 붙은 fitBounds 는 전환이
       * 끝나야 자리가 잡히는데, 탭이 뒤에 있거나 화면이 멈춘 환경에서는 그
       * 전환이 영영 안 끝나서 지도가 처음 배율에 그대로 머문다.
       */
      instance.fitBounds([toLeaflet(box[0]), toLeaflet(box[1])], {
        paddingTopLeft: [cap(left, width) + 16, 16],
        paddingBottomRight: [16, cap(bottom, height) + 16],
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
     * Leaflet 이 들고 있는 크기는 창이 바뀔 때마다 새로 잡아 준다. 다만 보던
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
        if (at) instance.panTo(toLeaflet(at), { animate: false });
        return;
      }
      fitPoints(lastFit.current ?? [...nodesRef.current.values()]);
    };

    let shape = shapeOf();
    let settle = 0;

    const onResize = () => {
      instance.invalidateSize({ animate: false });
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
    instance.invalidateSize({ animate: false });
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
    const layer = baseLayer.current;
    if (!layer) return;
    layer.clearLayers();

    for (const [id, links] of graph.links) {
      for (const link of links) {
        /* 양방향이라 같은 간선이 두 번 나온다. 한쪽만 그린다. */
        if (link.edge.from !== id) continue;

        const line = L.polyline(link.points.map(toLeaflet), {
          ...baseEdgeStyle(link.edge),
          ...(editing ? { interactive: true, weight: 6, opacity: 0.7 } : {}),
        });

        if (editing) {
          if (link.edge.id === selectedId) line.setStyle({ color: '#B45309' });
          line.on('click', (e) => {
            L.DomEvent.stop(e);
            handlers.current.onPickEdge(link.edge);
          });
        }
        line.addTo(layer);
      }
    }
  }, [graph, editing, selectedId]);

  /* ── 고른 경로 ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!route) return;

    if (compare) {
      L.polyline(compare.points.map(toLeaflet), compareStyle).addTo(layer);
    }

    L.polyline(route.points.map(toLeaflet), routeCasingStyle).addTo(layer);
    L.polyline(route.points.map(toLeaflet), routeStyle).addTo(layer);

    /* 이미 지나온 만큼은 회색으로 덮는다. 남은 길만 초록으로 남는다. */
    if (progress && progress.passed.length > 1) {
      L.polyline(progress.passed.map(toLeaflet), passedStyle).addTo(layer);
    }

    /* 경로 안의 지름길 구간에만 흰 점선을 덧씌워 눈에 띄게. */
    for (const leg of route.legs) {
      if (!leg.link.edge.shortcut) continue;
      L.polyline(leg.link.points.map(toLeaflet), shortcutOverlayStyle).addTo(
        layer,
      );
    }
  }, [route, compare, progress]);

  /* ── 장소 표시 ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const layer = markerLayer.current;
    if (!layer) return;
    layer.clearLayers();

    for (const node of graph.nodes.values()) {
      const isJunction = node.kind === 'junction';
      if (isJunction && (!editing || zoom < JUNCTION_ZOOM)) continue;

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

      const marker = L.marker(toLeaflet(node), {
        icon: endpoint
          ? endpointIcon(node.id === fromId ? '출발' : '도착', className)
          : isJunction
            ? junctionIcon(className)
            : placeIcon(node, className),
        draggable: editing,
        keyboard: false,
        zIndexOffset: endpoint ? 1000 : isJunction ? -200 : 0,
      });

      if (node.name) {
        marker.bindTooltip(node.name, {
          className: 'campus-label',
          direction: 'right',
          offset: [12, 0],
          permanent: true,
        });
      }

      marker.on('click', (e) => {
        L.DomEvent.stop(e);
        handlers.current.onPickNode(node);
      });
      if (editing) {
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();
          handlers.current.onMoveNode(node.id, { lat, lng });
        });
      }

      marker.addTo(layer);
    }
  }, [graph, editing, fromId, toId, zoom]);

  /* ── 현위치 ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    if (!here) {
      hereMarker.current?.remove();
      hereMarker.current = null;
      hereHalo.current?.remove();
      hereHalo.current = null;
      return;
    }

    /*
     * 오차 반경을 먼저 깐다. 점보다 아래에 있어야 점이 안 묻힌다.
     * 반경이 점만큼 작으면 그리지 않는다 — 테두리만 겹쳐 지저분해진다.
     */
    if (accuracy !== null && accuracy > HALO_MIN_METERS) {
      if (!hereHalo.current) {
        hereHalo.current = L.circle(toLeaflet(here), {
          ...accuracyStyle,
          radius: accuracy,
        }).addTo(instance);
      } else {
        hereHalo.current.setLatLng(toLeaflet(here));
        hereHalo.current.setRadius(accuracy);
      }
    } else {
      hereHalo.current?.remove();
      hereHalo.current = null;
    }

    if (!hereMarker.current) {
      hereMarker.current = L.marker(toLeaflet(here), {
        icon: hereIcon(s.here),
        interactive: false,
        zIndexOffset: 900,
      }).addTo(instance);
    } else {
      hereMarker.current.setLatLng(toLeaflet(here));
    }

    /*
     * 안내 중이면 계속 가운데에 둔다. 걸으면서 화면을 손으로 끌 수는 없다.
     * 안내를 안 켰을 때는 정말로 화면을 벗어났을 때만 옮긴다 — 지도를 들여다보는
     * 중에 몇 초마다 끌려가면 아무것도 볼 수 없다.
     */
    if (follow && needsGuideZoom.current) {
      needsGuideZoom.current = false;
      instance.setView(
        toLeaflet(here),
        Math.max(instance.getZoom(), GUIDE_ZOOM),
        { animate: false },
      );
    } else if (follow) {
      instance.panTo(toLeaflet(here), { animate: false });
    } else if (!instance.getBounds().pad(-0.15).contains(toLeaflet(here))) {
      instance.panTo(toLeaflet(here), { animate: false });
    }
  }, [here, accuracy, follow]);

  return <div ref={holder} className={s.container} />;
};

export default CampusMap;
