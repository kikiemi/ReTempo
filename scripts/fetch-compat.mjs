import {mkdir,writeFile} from 'node:fs/promises';
const base='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
await mkdir('public/compat',{recursive:true});
for(const name of ['ffmpeg-core.js','ffmpeg-core.wasm']){
    const response=await fetch(`${base}/${name}`);
    if(!response.ok)throw Error(`Download failed: ${name} (${response.status})`);
    await writeFile(`public/compat/${name}`,new Uint8Array(await response.arrayBuffer()));
}
console.log('Compatibility engine downloaded. Read THIRD_PARTY_NOTICES.md before redistributing it.');
