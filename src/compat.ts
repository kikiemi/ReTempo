import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
let engine:FFmpeg|null=null;
export function compat_cancel():void {engine?.terminate();engine=null;}
export async function compat_convert(file:File,on_progress:(value:number,text:string)=>void):Promise<File>
{
    if(file.size>128*1024*1024)throw Error('互換読み込みは128MB以下に制限しています。大きな旧形式ファイルはPCでMP4へ変換してください。');
    engine=new FFmpeg();
    const ff=engine,urls:string[]=[];
    ff.on('progress',e=>on_progress(Math.min(.99,Math.max(0,e.progress)),'互換形式へ変換中'));
    try {
        on_progress(0,'互換エンジンを読み込み中');
        const local=await fetch('./compat/ffmpeg-core.js',{method:'HEAD'}).then(r=>r.ok&&r.headers.get('content-type')?.includes('javascript')).catch(()=>false);
        const base=local?'./compat':'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
        const coreURL=await toBlobURL(`${base}/ffmpeg-core.js`,'text/javascript');urls.push(coreURL);
        const wasmURL=await toBlobURL(`${base}/ffmpeg-core.wasm`,'application/wasm');urls.push(wasmURL);
        await ff.load({coreURL,wasmURL,classWorkerURL:new URL('./ffmpeg/worker.js',location.href).href});
        await ff.createDir('/input');
        await ff.mount('WORKERFS' as any,{files:[file]},'/input');
        const result=await ff.exec(['-i',`/input/${file.name}`,'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','ultrafast','-crf','16','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-movflags','+faststart','/converted.mp4']);
        if(result!==0)throw Error('互換変換に失敗しました。この形式は対応していないか、ファイルが破損しています。');
        const bytes=await ff.readFile('/converted.mp4');
        return new File([bytes as Uint8Array<ArrayBuffer>],file.name.replace(/\.[^.]+$/,'')+'-compatible.mp4',{type:'video/mp4'});
    } finally {ff.terminate();engine=null;for(const url of urls)URL.revokeObjectURL(url);}
}
