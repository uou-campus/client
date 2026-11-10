/*
 * 캠퍼스 길찾기 서비스 워커.
 *
 * 캠퍼스 안은 신호가 잘 죽는다. 앱 껍데기와 한 번 본 지도 타일을 들고 있으면
 * 끊긴 자리에서도 길찾기가 그대로 된다. 그래프는 번들에 들어 있어 애초에
 * 네트워크를 안 탄다.
 *
 * 빌드 도구 없이 손으로 쓴다. 파일 이름에 해시가 붙어 목록을 미리 못 박으므로,
 * 껍데기만 미리 담고 나머지는 처음 받을 때 담는다.
 */

const VERSION = 'v5';
const SHELL = `campus-shell-${VERSION}`;
const ASSETS = `campus-assets-${VERSION}`;
const TILES = `campus-tiles-${VERSION}`;

/** 타일을 몇 장까지 들고 있을지. 캠퍼스 한 바퀴면 이 정도로 넉넉하다. */
const TILE_LIMIT = 500;

/*
 * 배경 지도(OpenFreeMap). 스타일·타일·글꼴·아이콘이 다 이 호스트에서 온다.
 * 벡터 타일이라 한 장이 넓은 자리를 덮어서, 같은 개수로 예전보다 많이 담긴다.
 */
const TILE_HOST = 'tiles.openfreemap.org';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll(['/', '/manifest.webmanifest', '/icon.svg']),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** 오래된 것부터 덜어 낸다. 캐시 키 순서가 곧 담은 순서다. */
const trim = async (cacheName, limit) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
};

/** 화면 이동: 새로 받아 보고, 안 되면 들고 있던 껍데기를 준다. */
const handleNavigation = async (request) => {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(SHELL);
    cache.put('/', fresh.clone());
    return fresh;
  } catch {
    const cache = await caches.open(SHELL);
    return (await cache.match('/')) ?? Response.error();
  }
};

/**
 * 빌드 산출물: 이름에 해시가 붙어 내용이 바뀌면 이름도 바뀐다. 본문 글꼴도
 * 여기로 나온다. 있으면 다시 물어보지 않고 그대로 쓴다.
 */
const handleImmutable = async (request) => {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;

  const fresh = await fetch(request);
  if (fresh.ok) cache.put(request, fresh.clone());
  return fresh;
};

/**
 * 이름이 그대로인 파일 — 매니페스트, 아이콘.
 *
 * 이쪽까지 캐시 우선으로 잡으면 한 번 담긴 값이 영영 안 바뀐다. 실제로 강조색을
 * 고쳐 올렸는데 화면은 새 색, 매니페스트만 옛 색으로 남는 일이 있었다.
 * 있으면 바로 내주되 뒤에서 새로 받아 두어 다음 방문부터 최신이 되게 한다.
 */
const handleRevalidate = async (request) => {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);

  const update = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => hit ?? Response.error());

  return hit ?? update;
};

/**
 * 지도 타일: 있으면 바로 내주고 뒤에서 조용히 새로 받아 둔다.
 *
 * 타일은 다른 출처라 no-cors 로 나가고, 그 응답은 opaque 다 — status 가 0 이고
 * ok 가 false 라서 ok 만 보고 거르면 한 장도 안 담긴다. put 은 opaque 도 받는다.
 */
const isStorable = (response) => response.ok || response.type === 'opaque';

const handleTile = async (request) => {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);

  const update = fetch(request)
    .then((fresh) => {
      if (isStorable(fresh)) {
        cache
          .put(request, fresh.clone())
          .then(() => trim(TILES, TILE_LIMIT))
          .catch(() => {
            /* 저장 공간이 꽉 찼다. 타일 없이도 앱은 돈다. */
          });
      }
      return fresh;
    })
    .catch(() => hit ?? Response.error());

  return hit ?? update;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.hostname === TILE_HOST) {
    event.respondWith(handleTile(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      url.pathname.startsWith('/assets/')
        ? handleImmutable(request)
        : handleRevalidate(request),
    );
  }
});
