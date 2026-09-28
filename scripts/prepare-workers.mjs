import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {transform} from 'esbuild';
await mkdir('public/ffmpeg',{recursive:true});
for(const name of ['worker.js','const.js','errors.js']){
    const code=await readFile(`node_modules/@ffmpeg/ffmpeg/dist/esm/${name}`,'utf8');
    const result=await transform(code,{minify:true,legalComments:'none',format:'esm'});
    await writeFile(`public/ffmpeg/${name}`,result.code);
}
