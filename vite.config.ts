import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file: works on GitHub Pages and as a private preview page.
// base is the repository path on GitHub Pages (https://<user>.github.io/mfr-beam-lab/).
export default defineConfig({
  base: '/mfr-beam-lab/',
  plugins: [viteSingleFile()],
});
