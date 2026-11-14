/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static build; the same files work at any path (GitHub Pages serves it under /<repo>/).
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
