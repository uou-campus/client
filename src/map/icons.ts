import type { CampusNode } from '@/types/campus';

/**
 * 지도 위 표시는 전부 손으로 만든 DOM 이다. 이미지 파일을 안 받으려고.
 *
 * 바깥 껍데기는 MapLibre 가 위치를 잡느라 transform 을 덮어쓴다. 그래서 모양과
 * 확대 효과(hover 때 scale)는 안쪽 점에 건다 — 껍데기에 걸면 점이 엉뚱한
 * 자리로 튄다.
 */
export interface MarkerElement {
  root: HTMLDivElement;
  dot: HTMLDivElement;
}

const build = (
  className: string,
  text: string,
  size: number,
  label?: string,
): MarkerElement => {
  const root = document.createElement('div');
  root.style.width = `${size}px`;
  root.style.height = `${size}px`;

  const dot = document.createElement('div');
  dot.className = className;
  dot.textContent = text;
  root.appendChild(dot);

  /* 예전 Leaflet 이름표처럼 점 가운데에서 오른쪽으로 12px. */
  if (label) {
    const tag = document.createElement('span');
    tag.className = 'campus-label';
    tag.textContent = label;
    tag.style.left = `${size / 2 + 12}px`;
    root.appendChild(tag);
  }
  return { root, dot };
};

export const placeIcon = (node: CampusNode, className: string) =>
  build(
    className,
    node.no ? String(node.no) : node.medical ? '+' : '',
    22,
    node.name,
  );

export const endpointIcon = (
  node: CampusNode,
  label: string,
  className: string,
) => build(className, label, 28, node.name);

export const junctionIcon = (node: CampusNode, className: string) =>
  build(className, '', 12, node.name);

export const hereIcon = (className: string) => build(className, '', 18);
