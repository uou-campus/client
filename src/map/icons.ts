import L from 'leaflet';
import type { CampusNode } from '@/types/campus';

/** 지도 위 표시는 전부 divIcon 이다. 이미지 파일을 안 받으려고. */
const div = (className: string, html: string, size: number) =>
  L.divIcon({
    className,
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

export const placeIcon = (node: CampusNode, className: string) =>
  div(className, node.no ? String(node.no) : node.medical ? '+' : '', 22);

export const endpointIcon = (label: string, className: string) =>
  div(className, label, 28);

export const junctionIcon = (className: string) => div(className, '', 12);

export const hereIcon = (className: string) => div(className, '', 18);
