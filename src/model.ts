export type pitch_mode_t = 'preserve' | 'follow' | 'custom';
export type segment_t = { id:number; start:number; end:number; speed:number; pitch:number; mode:pitch_mode_t; gain:number };
export type project_t = { version:1; name:string; duration:number; source_fps:number; segments:segment_t[] };
export type export_t = { format:'mp4'|'gif'; mode:'copy'|'encode'; quality:number; width:number; fps:number; mute:boolean; colors:number; loop:number; audio_bitrate:number };
export const clamp = (x:number,lo:number,hi:number):number => Math.max(lo,Math.min(hi,x));
export function new_project(duration:number,name='動画'):project_t
{
    return { version:1,name,duration,source_fps:30,segments:[{id:1,start:0,end:duration,speed:1,pitch:0,mode:'preserve',gain:1}] };
}
export function segment_duration(s:segment_t):number { return (s.end-s.start)/s.speed; }
export function project_duration(p:project_t):number { return p.segments.reduce((a,s)=>a+segment_duration(s),0); }
export function output_to_source(p:project_t,t:number):{time:number;index:number;offset:number}
{
    let offset=0;
    for(let i=0;i<p.segments.length;i++) {
        const s=p.segments[i],d=segment_duration(s);
        if(t<offset+d || i===p.segments.length-1) return {time:clamp(s.start+(t-offset)*s.speed,s.start,s.end),index:i,offset};
        offset+=d;
    }
    return {time:0,index:0,offset:0};
}
export function source_to_output(p:project_t,t:number):number
{
    let offset=0;
    for(const s of p.segments) {
        if(t<=s.end) return offset+clamp((t-s.start)/s.speed,0,segment_duration(s));
        offset+=segment_duration(s);
    }
    return offset;
}
export function split_segment(p:project_t,i:number,t:number):boolean
{
    const s=p.segments[i];
    if(!s || t-s.start<.01 || s.end-t<.01 || p.segments.length>=200) return false;
    const id=Math.max(...p.segments.map(x=>x.id))+1;
    p.segments.splice(i,1,{...s,end:t},{...s,id,start:t});
    return true;
}
export function validate_project(v:unknown,duration:number):project_t
{
    const p=v as project_t;
    if(!p || p.version!==1 || !Array.isArray(p.segments) || !p.segments.length || p.segments.length>200) throw Error('編集設定の形式が正しくありません。');
    let end=0;
    for(const s of p.segments) {
        if(![s.start,s.end,s.speed,s.pitch,s.gain].every(Number.isFinite) || s.start<end-1e-6 || s.end>duration+.002 || s.end-s.start<.01 || s.speed<.125 || s.speed>8 || Math.abs(s.pitch)>24 || s.gain<0 || s.gain>2 || !['preserve','follow','custom'].includes(s.mode)) throw Error('区間や速度が範囲外です。元の動画を選んでください。');
        end=s.end;
    }
    return {version:1,name:String(p.name||'動画').slice(0,200),duration,source_fps:clamp(Number(p.source_fps)||30,1,240),segments:p.segments.map((s,i)=>({id:i+1,start:s.start,end:s.end,speed:s.speed,pitch:s.pitch,mode:s.mode,gain:s.gain}))};
}
export function can_copy(p:project_t):boolean
{
    if(!p.segments.length || Math.abs(p.segments[0].start)>.001 || Math.abs(p.segments.at(-1)!.end-p.duration)>.002) return false;
    return p.segments.every((s,i)=>!i || Math.abs(s.start-p.segments[i-1].end)<1e-6);
}
export function pitch_ratio(s:segment_t):number { return s.mode==='follow'?s.speed:s.mode==='custom'?2**(s.pitch/12):1; }
export function audio_segments(segments:segment_t[]):segment_t[] {
    const out:segment_t[]=[];
    for(const segment of segments){const previous=out.at(-1);if(previous&&Math.abs(previous.end-segment.start)<1e-7&&previous.speed===segment.speed&&previous.gain===segment.gain&&Math.abs(pitch_ratio(previous)-pitch_ratio(segment))<1e-9)previous.end=segment.end;else out.push({...segment});}
    return out;
}
export function time_text(t:number,precise=false):string
{
    const x=Math.max(0,t),m=Math.floor(x/60),s=x-m*60;
    return `${m.toString().padStart(2,'0')}:${s.toFixed(precise?3:1).padStart(precise?6:4,'0')}`;
}
export function parse_time(s:string):number { return s.trim().split(':').reduce((a,v)=>a*60+Number(v),0); }
export function preview_volume(rendered:boolean,compare:boolean,gain:number):number{return clamp(rendered||compare?1:gain,0,1);}
export function can_copy_audio(p:project_t,codec:string,start:number,end:number,origin:number):boolean{return start>=origin-.05&&end<=origin+p.duration+.002&&can_copy(p)&&p.segments.every(s=>s.speed===1&&s.gain===1&&(s.mode!=='custom'||s.pitch===0))&&['aac','mp3','opus','flac'].includes(codec);}
