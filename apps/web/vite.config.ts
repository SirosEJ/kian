import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildThemeCss } from './src/theme/css.ts';

const tokensPath = fileURLToPath(new URL('./src/theme/tokens.json', import.meta.url));
const virtualId = 'virtual:kian-theme.css';

/** Serves `virtual:kian-theme.css`: CSS variables generated from the single brand token file. Edits to the file reload in dev. */
function kianTheme(): Plugin {
  return {
    name: 'kian-theme',
    resolveId: id => (id === virtualId ? `\0${virtualId}` : null),
    load(id) {
      if (id !== `\0${virtualId}`) return null;
      this.addWatchFile(tokensPath);
      return buildThemeCss(JSON.parse(readFileSync(tokensPath, 'utf8')));
    },
  };
}

export default defineConfig({ plugins: [react(), kianTheme()] });
