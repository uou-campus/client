/**
 * 지도에 깔 건물 이름표를 OSM 원본에서 뽑는다.
 *
 *   node scripts/make-building-labels.mjs
 *
 * 배경 지도(OpenFreeMap)의 건물 데이터에는 이름이 없다. 예전 OSM 지도는 건물
 * 위에 이름을 직접 써 줬기 때문에, 지도를 바꾸고 나서 「수위실」 「1공학관」
 * 같은 이름이 사라졌다. scripts/fetch-osm.mjs 가 받아 둔 이름 붙은 건물을
 * 그대로 꺼내 쓴다.
 *
 * 앱이 이미 번호 점으로 찍는 건물은 여기서 빼지 않는다. 그래프는 편집 모드에서
 * 바뀌므로, 겹치는지는 지도가 그때그때 그래프와 맞대 보고 정한다
 * (src/map/buildingLabels.ts).
 *
 * 데이터 출처: OpenStreetMap 기여자 (ODbL).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, 'osm-campus.json');
const OUT = resolve(HERE, '../src/data/building-labels.json');

if (!existsSync(SOURCE)) {
  console.error(
    `${SOURCE} 가 없습니다. 먼저 node scripts/fetch-osm.mjs 를 돌리세요.`,
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(SOURCE, 'utf-8'));

const round7 = (n) => Math.round(n * 1e7) / 1e7;

/**
 * 배경 지도가 아이콘과 이름을 따로 찍어 주는 건물인지.
 *
 * OpenMapTiles 의 poi 층은 이 열쇠가 붙은 것을 장소로 싣는다. 기숙사는
 * building=dormitory 만으로도 실린다. 이런 건물에 이름표를 또 깔면 같은 이름이
 * 두 번 뜬다. 다만 앱 마커와 겹치는 장소를 배경에서 지울 때 이름이 필요하니
 * 목록에는 남겨 두고 표시만 해 둔다.
 */
const POI_KEYS = [
  'amenity',
  'shop',
  'office',
  'leisure',
  'tourism',
  'historic',
  'sport',
];
const isPoi = (tags) =>
  POI_KEYS.some((key) => tags[key]) || tags.building === 'dormitory';

/**
 * 아파트 동 번호(「101」 「1동」 「A동」)처럼 짧은 것. 예전 지도도 바짝 당겨야
 * 보여 줬다. 지도에서 한 단계 더 당겨야 뜨게 따로 표시한다.
 */
const MINOR = /^[0-9A-Za-z]{1,4}동?$/;

const labels = [];

for (const element of raw.elements) {
  const tags = element.tags ?? {};
  if (!tags.building || !tags.name) continue;
  const at = element.center ?? (element.lat ? element : null);
  if (!at) continue;

  labels.push({
    name: tags.name,
    lat: round7(at.lat),
    lng: round7(at.lon),
    ...(MINOR.test(tags.name) ? { minor: true } : {}),
    ...(isPoi(tags) ? { poi: true } : {}),
  });
}

const doc = {
  $note:
    '자동 생성 파일. scripts/make-building-labels.mjs 가 scripts/osm-campus.json ' +
    '에서 이름 붙은 건물을 뽑았다. 손으로 고치지 말 것. ' +
    '데이터 © OpenStreetMap 기여자, ODbL.',
  generatedBy: 'scripts/make-building-labels.mjs',
  osmFetchedAt: raw.fetchedAt,
  osmSource: raw.source,
  labels,
};

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');

const poi = labels.filter((l) => l.poi).length;
const minor = labels.filter((l) => l.minor).length;
console.log(
  `건물 이름표 ${labels.length}개 (배경 지도 장소와 겹침 ${poi}, 동 번호 ${minor}) → ${OUT}`,
);
