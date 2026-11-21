import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file: works on GitHub Pages and as a private preview page.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
});
