import { Input,BlobSource,ALL_FORMATS,CanvasSink } from 'mediabunny';
export type media_info_t={duration:number;origin:number;width:number;height:number;fps:number;video_codec:string;audio_codec:string;channels:number;sample_rate:number;video_decodable:boolean;audio_decodable:boolean;tracks:number;hdr:boolean};
export function media_input(file:Blob):Input {return new Input({source:new BlobSource(file),formats:ALL_FORMATS});}
export async function media_probe(file:Blob):Promise<media_info_t>
{
    const input=media_input(file);
    try {
        const v=await input.getPrimaryVideoTrack(),a=await input.getPrimaryAudioTrack();
        if(!v) throw Error('映像トラックが見つかりません。');
        const [end,origin,stats,config]=await Promise.all([v.computeDuration(),v.getFirstTimestamp(),v.computePacketStats(120),v.getDecoderConfig()]);
        return {duration:end-origin,origin,width:v.displayWidth,height:v.displayHeight,fps:stats.averagePacketRate||30,video_codec:await v.getCodec()||'unknown',audio_codec:a?await a.getCodec()||'unknown':'none',channels:a?await a.getNumberOfChannels():0,sample_rate:a?await a.getSampleRate():0,video_decodable:await v.canDecode(),audio_decodable:a?await a.canDecode():true,tracks:(await input.getTracks()).length,hdr:['pq','hlg'].includes(config?.colorSpace?.transfer||'')};
    } finally {input.dispose();}
}
export async function media_poster(file:Blob,time=0):Promise<Blob|null>
{
    const input=media_input(file);
    try {
        const v=await input.getPrimaryVideoTrack();if(!v || !await v.canDecode())return null;
        const frame=await new CanvasSink(v,{width:960,poolSize:1}).getCanvas(time+await v.getFirstTimestamp());
        if(!frame)return null;
        const canvas=frame.canvas as OffscreenCanvas;
        if('convertToBlob' in canvas) return await canvas.convertToBlob({type:'image/jpeg',quality:.85});
        return await new Promise(r=>(frame.canvas as HTMLCanvasElement).toBlob(r,'image/jpeg',.85));
    } finally {input.dispose();}
}
