import {defineConfig} from 'vite';
export default defineConfig({base:'./',server:{host:'0.0.0.0',port:4173,strictPort:true,allowedHosts:['terminal.local']},worker:{format:'es'},build:{target:'es2022',sourcemap:false,minify:'esbuild',chunkSizeWarningLimit:900},esbuild:{legalComments:'none'}});
