import type { CampusNode, LatLng } from '@/types/campus';
import { distance } from '@/routing/geo';
import doc from '@/data/building-labels.json';

/**
 * OSM 원본에서 뽑아 둔 건물 이름표 하나.
 * 만드는 법은 scripts/make-building-labels.mjs.
 */
export interface BuildingLabel extends LatLng {
  name: string;
  /** 아파트 동 번호처럼 짧은 것. 더 당겨야 보여 준다. */
  minor?: boolean;
  /** 배경 지도가 아이콘과 이름을 따로 찍어 주는 건물. 이름표는 안 깐다. */
  poi?: boolean;
}

const LABELS = doc.labels as BuildingLabel[];

/** 띄어쓰기·빗금은 이름마다 제각각이라 빼고 맞댄다(「재료/산업공학관」). */
const normalize = (name: string) => name.replace(/[\s/]/g, '');

/**
 * 이 OSM 건물이 앱이 이미 찍는 그 건물인지.
 *
 * - 시드는 건물 마커를 OSM 건물 중심에 그대로 찍는다. 자리가 거의 같으면 이름이
 *   달라도(「제료산업공학관」→「재료/산업공학관」) 같은 건물이다.
 * - 이름이 같으면 같은 건물이다. 다만 가까울 때만 — 울산과학대에도 「대학회관」이
 *   있어서, 해송홀의 별칭과 이름만 같은 다른 건물이 지워질 뻔했다.
 * - 한쪽 이름이 다른 쪽을 품으면(「울산대학교 박물관」과 「박물관」) 더 가까울
 *   때만 같은 건물로 본다.
 */
const SAME_SPOT_M = 8;
const SAME_NAME_M = 150;
const SIMILAR_NAME_M = 80;

const isSameBuilding = (label: BuildingLabel, node: CampusNode) => {
  const meters = distance(label, node);
  if (meters < SAME_SPOT_M) return true;

  const target = normalize(label.name);
  const names = [node.name, ...(node.aliases ?? [])]
    .map(normalize)
    .filter(Boolean);

  if (meters < SAME_NAME_M && names.includes(target)) return true;
  return (
    meters < SIMILAR_NAME_M &&
    names.some((name) => name.includes(target) || target.includes(name))
  );
};

/**
 * 그래프와 맞대 보고 나눈다.
 *
 * - shown: 지도에 이름표로 깔 것. 앱 마커도 배경 지도 장소도 없는 건물이다.
 * - hiddenPoiNames: 배경 지도의 장소 중 감출 이름. 앱 마커와 같은 곳이라 이름이
 *   두 번 뜬다. 앱의 이름·별칭에 더해, 앱 마커와 짝지어진 OSM 건물의 원래 이름도
 *   넣는다(배경 지도는 「조선해양공학 수조」, 앱은 「해양공학수조」).
 */
export const splitBuildingLabels = (nodes: Iterable<CampusNode>) => {
  const named = [...nodes].filter((n) => n.kind !== 'junction' && n.name);

  const shown: BuildingLabel[] = [];
  const hidden = new Set<string>();
  for (const node of named) {
    hidden.add(node.name);
    for (const alias of node.aliases ?? []) hidden.add(alias);
  }

  for (const label of LABELS) {
    if (named.some((node) => isSameBuilding(label, node))) {
      hidden.add(label.name);
      continue;
    }
    if (!label.poi) shown.push(label);
  }

  return { shown, hiddenPoiNames: [...hidden] };
};
