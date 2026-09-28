import { StreamTarget } from 'mediabunny';
export type disk_t = {target:StreamTarget;write:(data:Uint8Array,position?:number)=>Promise<void>;finish:()=>Promise<{blob:Blob;temp:string|null}>;abort:()=>Promise<void>};
export async function disk_open(type:string):Promise<disk_t>
{
    let root:FileSystemDirectoryHandle|null=null,handle:FileSystemFileHandle|null=null,writer:FileSystemWritableFileStream|null=null;
    const name=`tempo-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    try {
        root=await navigator.storage.getDirectory();
        handle=await root.getFileHandle(name,{create:true});
        writer=await handle.createWritable();
    } catch {}
    const blocks:{data:Uint8Array;position:number}[]=[];
    let size=0,closed=false;
    async function write(data:Uint8Array,position=size):Promise<void> {
        if(closed) throw Error('保存先は閉じられています。');
        if(writer) await writer.write({type:'write',position,data:data as Uint8Array<ArrayBuffer>});
        else {
            if(position+data.byteLength>128*1024*1024) throw Error('このブラウザでは一時保存を使えません。出力が128MBを超えるため、区間を短くするか解像度を下げてください。');
            blocks.push({data:data.slice(),position});
        }
        size=Math.max(size,position+data.byteLength);
    }
    const target=new StreamTarget(new WritableStream({write:chunk=>write(chunk.data,chunk.position)}),{chunked:true,chunkSize:1024*1024});
    return {target,write,async finish(){
        closed=true;
        if(writer && handle) {await writer.close();writer=null;const file=await handle.getFile();return {blob:file.slice(0,file.size,type),temp:name};}
        const bytes=new Uint8Array(size);for(const b of blocks)bytes.set(b.data,b.position);blocks.length=0;
        return {blob:new Blob([bytes],{type}),temp:null};
    },async abort(){
        closed=true;try {await writer?.abort();} catch {}writer=null;
        try {await root?.removeEntry(name);} catch {}blocks.length=0;
    }};
}
export async function remove_temp(name:string|null):Promise<void>
{
    if(!name || !/^tempo-[a-zA-Z0-9.-]+\.tmp$/.test(name)) return;
    try {await (await navigator.storage.getDirectory()).removeEntry(name);} catch {}
}
