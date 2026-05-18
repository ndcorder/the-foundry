import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  build: { assets: '_assets' },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@lib': '/src/lib', '@components': '/src/components' }
    }
  }
});