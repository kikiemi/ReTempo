import {BufferTarget,Output,Mp4OutputFormat,WebMOutputFormat,EncodedAudioPacketSource,EncodedPacketSink} from 'mediabunny';
import type {InputAudioTrack} from 'mediabunny';
export async function audio_window(track:InputAudioTrack,start:number,end:number,check:()=>void):Promise<{buffer:ArrayBuffer;origin:number}|null>
{
    const codec=await track.getCodec(),config=await track.getDecoderConfig();
    if(!codec||!config)throw Error('音声形式を識別できませんでした。');
    if(codec==='opus'&&config.description) {
        const raw=config.description,description=ArrayBuffer.isView(raw)?new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength).slice():new Uint8Array(raw).slice();
        if(description.length>=19&&String.fromCharCode(...description.subarray(0,8))==='OpusHead'){description[10]=0;description[11]=0;config.description=description;}
    }
    const sink=new EncodedPacketSink(track),first=await sink.getPacket(Math.max(0,start-.15))||await sink.getFirstPacket();
    if(!first||first.timestamp>=end)return null;
    const target=new BufferTarget(),output=new Output({format:codec==='vorbis'?new WebMOutputFormat():new Mp4OutputFormat(),target});
    const source=new EncodedAudioPacketSource(codec);output.addAudioTrack(source);await output.start();
    let bytes=0,initial=true;
    try {
        for await(const packet of sink.packets(first)) {
            check();if(packet.timestamp>=end+.15)break;
            bytes+=packet.data.byteLength;if(bytes>16*1024*1024)throw Error('音声の処理区間が大きすぎます。');
            await source.add(packet.clone({timestamp:packet.timestamp-first.timestamp}),initial?{decoderConfig:config}:undefined);initial=false;
        }
        source.close();await output.finalize();
        return {buffer:target.buffer!,origin:first.timestamp};
    }catch(error){await output.cancel().catch(()=>{});throw error;}
}
export async function audio_window_decode(buffer:ArrayBuffer,sample_rate:number,channels:number):Promise<Float32Array[]>
{
    const context=new OfflineAudioContext(channels,1,sample_rate);
    const audio=await context.decodeAudioData(buffer);
    if(audio.numberOfChannels!==channels)throw Error('音声のチャンネル数を正しく復元できませんでした。');
    if(audio.length*channels*4>48*1024*1024)throw Error('音声の処理区間が大きすぎます。');
    return Array.from({length:channels},(_,c)=>audio.getChannelData(c).slice());
}
