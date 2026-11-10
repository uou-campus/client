import type { LatLng } from '@/types/campus';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** 두 점 사이 대권 거리(m). 캠퍼스 규모에선 사실상 직선거리다. */
export const distance = (a: LatLng, b: LatLng): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** 꺾인 선의 총 길이(m). */
export const polylineLength = (points: LatLng[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
};

/** a 에서 b 를 볼 때의 방위각(0~360, 북쪽이 0). */
export const bearing = (a: LatLng, b: LatLng): number => {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

/** 두 방위각의 차이를 -180~180 으로. 양수면 오른쪽으로 꺾인 것. */
export const turnAngle = (from: number, to: number): number => {
  const diff = ((to - from + 540) % 360) - 180;
  return diff;
};

const M_PER_DEG_LAT = 111_320;

/**
 * 위경도를 기준점 기준의 미터 평면으로 옮긴다.
 * 캠퍼스 한 귀퉁이 크기에서는 이 근사로 충분하고, 선분 위 최근접점을 구할 때
 * 삼각함수 없이 곧바로 계산할 수 있다.
 */
export const toPlane = (point: LatLng, origin: LatLng) => ({
  x: (point.lng - origin.lng) * M_PER_DEG_LAT * Math.cos(toRad(origin.lat)),
  y: (point.lat - origin.lat) * M_PER_DEG_LAT,
});

/** 미터 평면의 점을 다시 위경도로. */
export const fromPlane = (
  plane: { x: number; y: number },
  origin: LatLng,
): LatLng => ({
  lat: origin.lat + plane.y / M_PER_DEG_LAT,
  lng: origin.lng + plane.x / (M_PER_DEG_LAT * Math.cos(toRad(origin.lat))),
});

/** 여러 점을 다 담는 사각형. 지도의 fitBounds 에 넘긴다. */
export const boundsOf = (points: LatLng[]): [LatLng, LatLng] | null => {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  return [
    { lat: minLat, lng: minLng },
    { lat: maxLat, lng: maxLng },
  ];
};
