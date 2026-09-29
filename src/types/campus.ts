/** 지도 위 한 점. */
export interface LatLng {
  lat: number;
  lng: number;
}

export type NodeKind = 'building' | 'place' | 'gate' | 'junction';

/**
 * 좌표를 얼마나 믿을 수 있는지.
 * - surveyed : OpenStreetMap 실측이거나, 편집 모드에서 사람이 직접 맞춘 값.
 * - approx   : 어림으로 찍어 둔 값. 아직 걸어 보고 확인하지 않았다.
 */
export type Precision = 'approx' | 'surveyed';

export interface CampusNode extends LatLng {
  id: string;
  kind: NodeKind;
  /** 길목은 이름이 없다. */
  name: string;
  /** 캠퍼스 지도의 건물 번호. */
  no?: number;
  aliases?: string[];
  precision: Precision;
  note?: string;
  /** 의무실. 지도에 빨간 점으로 따로 찍는다. */
  medical?: boolean;
  /** 건물 안에서 찾아 들어가는 법. 도착 안내 밑에 붙인다. */
  access?: string;
}

export type Surface =
  | 'road' /** 차도 옆 인도 */
  | 'path' /** 캠퍼스 보행로 */
  | 'stairs' /** 계단 */
  | 'slope' /** 비탈 */
  | 'indoor' /** 건물 안을 가로지름 */
  | 'crosswalk'; /** 횡단 */

/** 이 길을 어디서 알았는지. */
export type EdgeSource =
  | 'osm' /** OpenStreetMap 실측 형상 */
  | 'assumed' /** 지도 배치를 보고 추정 */
  | 'walked'; /** 직접 걸어 보고 확인 */

export interface CampusEdge {
  id: string;
  from: string;
  to: string;
  surface: Surface;
  /** 아는 사람만 다니는 길. 결과에 따로 표시한다. */
  shortcut: boolean;
  /** 비를 안 맞는 구간. */
  covered: boolean;
  /** 건물을 길에 매달아 둔 접속선. 큰길만 쓰는 계산에서도 빼면 안 된다. */
  connector: boolean;
  source: EdgeSource;
  /** 꺾이는 지점들. 없으면 두 노드를 직선으로 잇는다. */
  via?: LatLng[];
  note?: string;
}

export interface CampusGraphDoc {
  $note?: string;
  generatedBy?: string;
  /** OSM 원본을 언제, 어디서 받아 왔는지. */
  osmFetchedAt?: string;
  osmSource?: string;
  nodes: CampusNode[];
  edges: CampusEdge[];
}
