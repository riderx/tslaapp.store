import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { globSync } from 'glob'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'copy-wasm-worklet',
      // Remove buildStart hook since dev works without copying
      closeBundle() {
        // Only copy files for production build
        copyWasmWorkletFiles();
        copyThreeJsFiles();
      }
    }
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  build: {
    assetsInlineLimit: 0, // Don't inline any assets as base64
    rollupOptions: {
      output: {
        // Ensure worklet files are correctly copied and available at runtime
        assetFileNames: (assetInfo) => {
          if (!assetInfo.name) return 'assets/[name]-[hash][extname]';
          
          if (/\.(wasm|js|worklet|worker)$/.test(assetInfo.name)) {
            return `assets/[name][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      }
    }
  }
})

// Function to copy WASM and worklet files for production
function copyWasmWorkletFiles() {
  const sourceDir = 'src/engine/engine_sound_generator';
  const destDir = 'dist/src/engine/engine_sound_generator';
  
  // Create destination directory if it doesn't exist
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  
  // Create wasm subdirectory
  const wasmDestDir = `${destDir}/sound_generator_wasm`;
  if (!existsSync(wasmDestDir)) {
    mkdirSync(wasmDestDir, { recursive: true });
  }
  
  // Copy all JS files from engine_sound_generator
  const jsFiles = globSync(`${sourceDir}/*.js`);
  jsFiles.forEach((file: string) => {
    const filename = file.split('/').pop();
    if (filename) {
      copyFileSync(file, `${destDir}/${filename}`);
      console.log(`Copied ${filename} to ${destDir}`);
    }
  });
  
  // Copy all files from wasm directory
  const wasmSourceDir = `${sourceDir}/sound_generator_wasm`;
  const wasmFiles = globSync(`${wasmSourceDir}/*.{js,wasm}`);
  wasmFiles.forEach((file: string) => {
    const filename = file.split('/').pop();
    if (filename && (filename.endsWith('.js') || filename.endsWith('.wasm'))) {
      copyFileSync(file, `${wasmDestDir}/${filename}`);
      console.log(`Copied ${filename} to ${wasmDestDir}`);
    }
  });
}

// Function to copy Three.js files for production
function copyThreeJsFiles() {
  const sourceDir = 'src/engine/three_js/build';
  const destDir = 'dist/src/engine/three_js/build';
  
  // Create destination directory if it doesn't exist
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  
  // Copy Three.js module files
  const threeFiles = globSync(`${sourceDir}/*.js`);
  threeFiles.forEach((file: string) => {
    const filename = file.split('/').pop();
    if (filename) {
      copyFileSync(file, `${destDir}/${filename}`);
      console.log(`Copied Three.js file ${filename} to ${destDir}`);
    }
  });
}
