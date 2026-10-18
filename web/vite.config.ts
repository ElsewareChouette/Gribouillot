import { defineConfig } from 'vite';

// The toolbar icons are shared with the desktop version (../resources/icons),
// hence the fs.allow on the parent directory.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
});
