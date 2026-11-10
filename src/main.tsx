import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@/styles/global.css';
import { initAnalytics } from '@/analytics/gtag';
import App from './App.tsx';

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * 서비스 워커는 빌드본에서만 등록한다. 개발 중에 끼면 고친 코드 대신 캐시가
 * 나와서 사람을 헷갈리게 한다.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 사생활 보호 모드거나 지원을 안 한다. 앱은 그대로 돌아간다. */
    });
  });
}
