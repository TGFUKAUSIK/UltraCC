import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

// The two faces the app is set in, by the name Vite gives their files. Only the
// Latin subset ships.
const FACE_ASSETS = /(bricolage-grotesque|jetbrains-mono)-latin-wght-normal/;

/**
 * Preload the app's own faces.
 *
 * Both live inside the stylesheet as hashed assets, so a browser cannot start
 * fetching them until the CSS has been downloaded *and* parsed. On the campus
 * wifi that is a visible beat of the phone's system font before the app appears
 * as itself. A preload link is found instead by the HTML preload scanner, in
 * parallel with the stylesheet, which costs one line of HTML to buy back.
 *
 * A font preload is always a CORS request, even same-origin, so `crossorigin`
 * is required here and not decoration.
 */
function preloadFaces(): Plugin {
  return {
    name: 'ultracc-preload-faces',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      const faces = Object.values(ctx.bundle ?? {})
        .filter((asset) => asset.type === 'asset' && FACE_ASSETS.test(asset.fileName))
        .map((asset) => asset.fileName);
      if (!faces.length) return html;
      const links = faces
        .map((file) => `    <link rel="preload" href="/${file}" as="font" type="font/woff2" crossorigin="anonymous">`)
        .join('\n');
      return html.replace('</head>', `${links}\n  </head>`);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), preloadFaces()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
