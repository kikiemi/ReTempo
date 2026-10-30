import { AudioSample,AudioSampleSink,AudioSampleSource,VideoSampleSink,VideoSampleSource,EncodedPacketSink,EncodedVideoPacketSource,EncodedAudioPacketSource,Mp4OutputFormat,Output,canEncodeAudio,canEncodeVideo } from 'mediabunny';
import type { InputAudioTrack,InputVideoTrack } from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import { GIFEncoder,quantize,applyPalette } from 'gifenc';
import { media_input } from './media';
import { audio_transform } from './dsp';
import { audio_window } from './audio-bridge';
import { disk_open,remove_temp } from './output';
import { can_copy,can_copy_audio,project_duration,source_to_output,output_to_source,pitch_ratio,segment_duration,audio_segments } from './model';
import type { project_t,export_t,segment_t } from './model';
registerAacEncoder();
let cancelled=false,busy=false,audio_fallback=false;
let decode_pending:{resolve:(channels:Float32Array[])=>void;reject:(error:Error)=>void;id:number}|null=null,decode_id=0;
async function fallback_audio(track:InputAudioTrack,start:number,end:number,sr:number,nch:number):Promise<Float32Array[]> {
    const length=Math.max(1,Math.round((end-start)*sr));
    if(length*nch*4>32*1024*1024)throw Error('音声の処理区間が大きすぎます。速度を下げて試してください。');
    const result=Array.from({length:nch},()=>new Float32Array(length)),part=await audio_window(track,start,end,check);
    if(!part)return result;
    const planes=await new Promise<Float32Array[]>((resolve,reject)=>{
        const id=++decode_id,timer=setTimeout(()=>{decode_pending=null;reject(Error('音声の読み込みがタイムアウトしました。画面を開いたまま再実行してください。'));},60000);
        decode_pending={id,resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}};
        self.postMessage({type:'decode-audio',id,buffer:part.buffer,sample_rate:sr,channels:nch},[part.buffer]);
    });
    check();const offset=Math.round((part.origin-start)*sr);
    for(let c=0;c<nch;c++){const from=Math.max(0,-offset),size=Math.min(planes[c].length-from,length-Math.max(0,offset));if(size>0)result[c].set(planes[c].subarray(from,from+size),Math.max(0,offset));}
    return result;
}
function check():void {if(cancelled)throw new DOMException('キャンセルしました。','AbortError');}
function progress(value:number,stage:string):void {self.postMessage({type:'progress',value,stage});}
function map_time(p:project_t,t:number):number {
    if(t<0)return t/p.segments[0].speed;
    if(t>p.duration)return project_duration(p)+(t-p.duration)/p.segments.at(-1)!.speed;
    return source_to_output(p,t);
}
async function read_audio(track:InputAudioTrack,start:number,end:number,sr:number,nch:number):Promise<Float32Array[]>
{
    if(audio_fallback)return fallback_audio(track,start,end,sr,nch);
    const length=Math.max(1,Math.round((end-start)*sr)),channels=Array.from({length:nch},()=>new Float32Array(length));
    const sink=new AudioSampleSink(track);
    for await(const sample of sink.samples(Math.max(0,start),end)) {
        try {
            check();
            if(sample.sampleRate!==sr || sample.numberOfChannels!==nch)throw Error('途中で音声形式が変わる動画です。互換読み込みを使用してください。');
            const dst=Math.round((sample.timestamp-start)*sr),from=Math.max(0,-dst),to=Math.min(sample.numberOfFrames,length-dst);
            if(to>from)for(let c=0;c<nch;c++)sample.copyTo(channels[c].subarray(dst+from,dst+to),{format:'f32-planar',planeIndex:c,frameOffset:from,frameCount:to-from});
        } finally {sample.close();}
    }
    return channels;
}
async function* audio_chunks(track:InputAudioTrack,p:project_t,origin:number):AsyncGenerator<AudioSample>
{
    const source_rate=await track.getSampleRate(),sr=audio_fallback&&(source_rate<8000||source_rate>96000)?48000:source_rate,nch=await track.getNumberOfChannels(),overlap=Math.round(sr*.016);
    const segments=audio_segments(p.segments);
    let offset=0,global_frame=0;
    for(const s of segments) {
        const total=Math.round(segment_duration(s)*sr),step=sr*2;
        let tail:Float32Array[]|null=null;
        for(let at=0;at<total;at+=step) {
            check();
            const size=Math.min(step,total-at),extra=Math.min(overlap,total-at-size),pad=.08;
            const source_start=s.start+(at/sr-pad)*s.speed,source_end=s.start+((at+size+extra)/sr+pad)*s.speed;
            const data=await read_audio(track,source_start+origin,source_end+origin,sr,nch);
            const transformed=audio_transform(data,s.speed,pitch_ratio(s),sr),skip=Math.round(pad*sr);
            const planes=transformed.map(a=>a.slice(skip,skip+size+extra));
            if(tail)for(let c=0;c<nch;c++)for(let i=0;i<Math.min(overlap,size,tail[c].length);i++) {
                const mix=.5-.5*Math.cos(Math.PI*i/overlap);planes[c][i]=tail[c][i]*(1-mix)+planes[c][i]*mix;
            }
            tail=planes.map(a=>a.slice(size));
            const raw=new Float32Array(size*nch),fade=Math.min(128,Math.floor(total/4));
            for(let c=0;c<nch;c++)for(let i=0;i<size;i++) {
                let gain=s.gain;
                if(segments.length>1)gain*=Math.min(1,(at+i+1)/fade,(total-at-i)/fade);
                raw[c*size+i]=Math.max(-1,Math.min(1,(planes[c][i]||0)*gain));
            }
            yield new AudioSample({data:raw,format:'f32-planar',sampleRate:sr,numberOfChannels:nch,timestamp:global_frame/sr});
            global_frame+=size;
        }
        offset+=segment_duration(s);
    }
}
async function encode_file(file:File,p:project_t,opt:export_t):Promise<void>
{
    const input=media_input(file),disk=await disk_open(opt.format==='gif'?'image/gif':'video/mp4');
    let output:Output|null=null;
    try {
        const video=await input.getPrimaryVideoTrack(),audio=opt.mute?null:await input.getPrimaryAudioTrack();
        if(!video)throw Error('動画を読み取れません。');
        const origin=await video.getFirstTimestamp(),duration=project_duration(p);
        if(!(duration>0) || !Number.isFinite(duration))throw Error('保存する区間がありません。');
        const copy=opt.format==='mp4' && opt.mode==='copy';
        if(copy && !can_copy(p))throw Error('トリミング・区間削除後は「画質指定」を選んでください。');
        const video_codec=await video.getCodec();
        if(copy && (!video_codec || !['avc','hevc','av1','vp9'].includes(video_codec)))throw Error('この映像はMP4への無再圧縮保存に対応していません。「画質指定」を選んでください。');
        if(!copy && !await video.canDecode())throw Error('この映像のデコーダーがありません。互換読み込みを試してください。');
        let width=opt.width?Math.min(opt.width,video.displayWidth):video.displayWidth;
        width=Math.max(2,Math.round(width/2)*2);
        const height=Math.max(2,Math.round(width*video.displayHeight/video.displayWidth/2)*2);
        if(opt.format==='gif') {
            await gif_write(video,p,opt,origin,width,height,disk.write);
        } else {
            const audio_copy=audio && can_copy_audio(p,await audio.getCodec()||'',await audio.getFirstTimestamp(),await audio.computeDuration(),origin);
            audio_fallback=!!audio&&!audio_copy&&!await audio.canDecode();
            const sr=audio?await audio.getSampleRate():48000,nch=audio?await audio.getNumberOfChannels():2;
            const audio_rate=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350].includes(sr)?sr:48000;
            if(audio && !audio_copy) {
                if(!await canEncodeAudio('aac',{sampleRate:audio_rate,numberOfChannels:nch,bitrate:opt.audio_bitrate}))throw Error(`音声の保存条件に対応していません（${sr} Hz・${nch} ch・${Math.round(opt.audio_bitrate/1000)} kbps）。1〜8チャンネルの音声を使用してください。`);
                if(audio_rate!==sr)self.postMessage({type:'notice',message:`AACで保存するため、音声を${sr} Hzから${audio_rate} Hzへ変換します。`});
            }
            const bitrate=Math.round(width*height*(opt.fps||30)*(.04+opt.quality*.0035));
            if(!copy && !await canEncodeVideo('avc',{width,height,bitrate}))throw Error('この解像度ではH.264を書き出せません。解像度を下げてください。');
            output=new Output({format:new Mp4OutputFormat({fastStart:false}),target:disk.target});
            const vsource=copy?new EncodedVideoPacketSource(video_codec!):new VideoSampleSource({codec:'avc',bitrate,latencyMode:'quality',keyFrameInterval:2,transform:{width,height,fit:'contain'}});
            output.addVideoTrack(vsource,copy?{transformationMatrix:await video.getTransformationMatrix()}:{});
            const asource=audio?(audio_copy?new EncodedAudioPacketSource((await audio.getCodec())!):new AudioSampleSource({codec:'aac',bitrate:opt.audio_bitrate,transform:audio_rate!==sr?{sampleRate:audio_rate}:undefined})):null;
            if(asource)output.addAudioTrack(asource);
            await output.start();
            const ai=audio?(audio_copy?new EncodedPacketSink(audio).packets():audio_chunks(audio,p,origin)):null;
            let next=ai?await ai.next():null,a_meta=audio_copy?await audio!.getDecoderConfig():null;
            async function pump(until:number):Promise<void> {
                while(next && !next.done && next.value.timestamp-(audio_copy?origin:0)<until) {
                    check();
                    const data=next.value;
                    if(audio_copy)await (asource as EncodedAudioPacketSource).add((data as any).clone({timestamp:data.timestamp-origin}),a_meta?{decoderConfig:a_meta}:undefined);
                    else {try {await (asource as AudioSampleSource).add(data as AudioSample);} finally {(data as AudioSample).close();}}
                    a_meta=null;next=await ai!.next();
                }
            }
            try {
                if(copy) {
                    let first=true;const config=await video.getDecoderConfig();
                    for await(const packet of new EncodedPacketSink(video).packets()) {
                        check();const t=packet.timestamp-origin,ts=map_time(p,t),end=map_time(p,t+packet.duration);
                        await (vsource as EncodedVideoPacketSource).add(packet.clone({timestamp:ts,duration:Math.max(0,end-ts)}),first&&config?{decoderConfig:config}:undefined);first=false;
                        await pump(ts+.4);progress(Math.min(.97,ts/duration),'映像をそのまま保存中');
                    }
                } else {
                    const fps=opt.fps||30,count=Math.ceil(duration*fps),sink=new VideoSampleSink(video);
                    function* times(){for(let i=0;i<count;i++)yield output_to_source(p,i/fps).time+origin;}
                    let i=0;
                    for await(const frame of sink.samplesAtTimestamps(times())) {
                        check();const t=i/fps;
                        if(!frame)throw Error('映像フレームを復元できませんでした。互換読み込みを試してください。');
                        try {frame.setTimestamp(t);frame.setDuration(Math.min(1/fps,duration-t));await (vsource as VideoSampleSource).add(frame);} finally {frame.close();}
                        await pump(t+.4);i++;progress(.97*i/count,'映像と音声を処理中');
                    }
                }
                await pump(Infinity);vsource.close();asource?.close();check();progress(.99,'ファイルを仕上げています');await output.finalize();
            } finally {
                if(next && !next.done && !audio_copy)(next.value as AudioSample).close();
                await ai?.return(undefined as never);
            }
        }
        check();const result=await disk.finish();self.postMessage({type:'done',...result});
    } catch(error) {
        try {await output?.cancel();} catch {}await disk.abort();throw error;
    } finally {input.dispose();}
}
async function gif_write(v:InputVideoTrack,p:project_t,opt:export_t,origin:number,width:number,height:number,write:(d:Uint8Array)=>Promise<void>):Promise<void>
{
    if(width*height>1920*1080)throw Error('GIFの解像度を1920×1080以下にしてください。');
    const fps=Math.min(50,opt.fps||15),duration=project_duration(p),count=Math.ceil(duration*fps),encoder=GIFEncoder();
    const sink=new VideoSampleSink(v);
    function* times(){for(let i=0;i<count;i++)yield output_to_source(p,i/fps).time+origin;}
    let i=0,delay_sum=0;
    for await(const frame of sink.samplesAtTimestamps(times())) {
        check();if(!frame)throw Error('GIF用の映像フレームを読み取れません。');
        let transformed;let rgba:Uint8Array;
        try {transformed=await frame.transform({width,height,fit:'contain'});rgba=new Uint8Array(width*height*4);await transformed.copyTo(rgba,{format:'RGBA'});}finally{transformed?.close();frame.close();}
        const palette=quantize(rgba,opt.colors,{format:'rgb565'}),indexed=applyPalette(rgba,palette,'rgb565');
        const until=Math.round(Math.min((i+1)/fps,duration)*100),delay=Math.max(2,until-delay_sum);delay_sum+=delay;
        encoder.writeFrame(indexed,width,height,{palette,delay:delay*10,repeat:opt.loop});
        await write(encoder.bytesView());encoder.stream.reset();i++;progress(.98*i/count,'GIFを作成中');
    }
    encoder.finish();await write(encoder.bytesView());
}
self.onmessage=async(e:MessageEvent)=>{
    const m=e.data;
    if(m.type==='decode-audio-result'){if(decode_pending&&decode_pending.id===m.id){const pending=decode_pending;decode_pending=null;if(m.error)pending.reject(Error(m.error));else pending.resolve(m.planes);}return;}
    if(m.type==='cancel'){cancelled=true;decode_pending?.reject(Error('処理を中止しました。'));decode_pending=null;return;}
    if(m.type==='cleanup'){await remove_temp(m.name);return;}
    if(m.type!=='export'||busy)return;
    busy=true;cancelled=false;audio_fallback=false;
    try {await encode_file(m.file,m.project,m.options);}catch(error){self.postMessage({type:cancelled?'cancelled':'error',message:error instanceof Error?error.message:String(error)});}finally{busy=false;}
};
