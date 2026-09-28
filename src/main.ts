import './style.css';
import {notice_post,notice_render,notice_clear} from './notices';
import { icons_apply,icon } from './icons';
import { ruler_create } from './ruler';
import { new_project,project_duration,segment_duration,output_to_source,source_to_output,split_segment,validate_project,can_copy,preview_volume,clamp,time_text,parse_time } from './model';
import type { project_t,export_t,pitch_mode_t } from './model';
import type { media_info_t } from './media';
import { remove_temp } from './output';
const $=<T extends HTMLElement=HTMLElement>(id:string):T=>document.getElementById(id) as T;
const video=$<HTMLVideoElement>('video');
let file:File|null=null,info:media_info_t|null=null,project:project_t=new_project(0),selected=0,source_url='',poster_url='',render_url='',render_temp:string|null=null,render_start=0,render_base=0,render_duration=0;
let compare=false,loop=false,format:'mp4'|'gif'='mp4',active_job:Worker|null=null,working=false,result_blob:Blob|null=null,result_url='',result_temp:string|null=null,open_token=0,drag_snapshot:string|null=null;
let past:string[]=[],future:string[]=[],wake:WakeLockSentinel|null=null,compat_mode=false,tick_handle=0;
const speed_ruler=ruler_create($('speed-ruler'),'speed',(v,done)=>ruler_change('speed',v/100,done));
const pitch_ruler=ruler_create($('pitch-ruler'),'pitch',(v,done)=>ruler_change('pitch',v,done));
icons_apply();
function pane_select(pane:string):void {
    if(!['player','timeline','adjust'].includes(pane))return;
    document.body.dataset.pane=pane;
    document.querySelectorAll<HTMLElement>('[data-pane-target]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.paneTarget===pane)));
    render_segment_list();update_player();
}
document.querySelectorAll<HTMLElement>('[data-pane-target]').forEach(b=>b.addEventListener('click',()=>{pane_select(b.dataset.paneTarget!);if(matchMedia('(max-width:760px)').matches)$(`pane-${b.dataset.paneTarget}`).scrollIntoView({block:'start',behavior:'smooth'});}));
on('log-open',()=>{notice_render();$<HTMLDialogElement>('log-dialog').showModal();});
on('log-clear',notice_clear);on('toast-stack',()=>{notice_render();$<HTMLDialogElement>('log-dialog').showModal();});

function on(id:string,fn:()=>void|Promise<void>):void {$(id).addEventListener('click',()=>{Promise.resolve().then(fn).catch(error=>message(error instanceof Error?error.message:String(error),true));});}
function text(id:string,value:string):void {const node=$(id);if(node.textContent!==value)node.textContent=value;}
function message(value:string,error=false,done=false):void {notice_post(value,error?'error':done?'success':'info');}
function bytes(n:number):string{return n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(1)} MB`;}
function snapshot():string{return JSON.stringify(project);}
function history_push(before:string):void {if(before===snapshot())return;past.push(before);if(past.length>60)past.shift();future=[];save_draft();render();}
function mutate(fn:()=>void):void {if(!file||working)return;const before=snapshot();fn();invalidate_preview();history_push(before);}
function ruler_change(key:'speed'|'pitch',value:number,done:boolean):void {
    if(!file||working)return;
    if(!drag_snapshot)drag_snapshot=snapshot();project.segments[selected][key]=value;invalidate_preview();render_settings();render_timeline();
    if(done){const before=drag_snapshot;drag_snapshot=null;history_push(before);}
}
function set_speed(value:number):void {if(!Number.isFinite(value))return;mutate(()=>{project.segments[selected].speed=clamp(value,.125,8);});}
function set_pitch(value:number):void {if(!Number.isFinite(value))return;mutate(()=>{project.segments[selected].pitch=clamp(value,-24,24);});}
function save_draft():void {if(!file)return;try{localStorage.setItem('tempo-draft',JSON.stringify({fingerprint:`${file.name}:${file.size}:${file.lastModified}`,project}));}catch{}}
function invalidate_preview():void {
    if(render_url){const source=current_source();video.pause();video.src=source_url;video.currentTime=source+(info?.origin||0);URL.revokeObjectURL(render_url);render_url='';void remove_temp(render_temp);render_temp=null;}
    update_rate();
}
function current_source():number {
    if(render_url)return output_to_source(project,render_base+video.currentTime).time;
    return Math.max(0,video.currentTime-(info?.origin||0));
}
function current_output():number {return render_url?render_base+video.currentTime:source_to_output(project,current_source());}
function playback_segment():number {
    const time=current_source();let i=project.segments.findIndex(s=>time>=s.start-.002 && time<s.end-.002);if(i<0)i=project.segments.findIndex(s=>time<s.start);return i<0?project.segments.length-1:i;
}
function update_rate():void {
    if(!file)return;const s=project.segments[Math.max(0,playback_segment())];
    try{video.playbackRate=render_url||compare?1:s.speed;}catch{video.pause();message('この速度は直接再生できません。「音程込みで確認」でプレビューを作成してください。');}
    video.preservesPitch=!!render_url||compare||s.mode!=='follow';video.volume=preview_volume(!!render_url,compare,s.gain);
    text('viewer-rate',`${(compare?1:s.speed).toFixed(2)}×`);
    text('viewer-mode',compare?'元動画':render_url?'音程反映済み':s.mode==='follow'?'速度に連動':s.mode==='custom'?'音程は確認ボタンで反映':'音程を保持');
    text('preview-tag',compare?'元動画':render_url?'処理済み':'リアルタイム');
}
function seek_output(t:number):void {
    if(!file)return;const target=clamp(t,0,project_duration(project));
    if(render_url && target>=render_base && target<render_base+render_duration) video.currentTime=target-render_base;
    else {invalidate_preview();video.currentTime=output_to_source(project,target).time+(info?.origin||0);}
    update_rate();update_player();
}
function select_segment(index:number,seek=true):void {selected=clamp(index,0,project.segments.length-1);if(seek)seek_output(source_to_output(project,project.segments[selected].start));render();}
function render_settings():void {
    const s=project.segments[selected];
    $('inspector-disabled')?.remove();
    $<HTMLInputElement>('speed-input').value=String(Math.round(s.speed*1000)/10);speed_ruler.set(s.speed*100);text('speed-factor',`${s.speed.toFixed(2)}×`);
    $<HTMLInputElement>('pitch-input').value=String(s.pitch);pitch_ruler.set(s.pitch);$('pitch-controls').hidden=s.mode!=='custom';
    $<HTMLInputElement>('gain-input').value=String(Math.round(s.gain*100));
    document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b=>b.classList.toggle('active',Math.abs(Number(b.dataset.speed)-s.speed*100)<.05));
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===s.mode);b.setAttribute('aria-pressed',String(b.dataset.mode===s.mode));});
    text('selection-label',project.segments.length===1?'全体':`区間 ${String(selected+1).padStart(2,'0')}`);
    $<HTMLInputElement>('trim-start').value=time_text(s.start,true);$<HTMLInputElement>('trim-end').value=time_text(s.end,true);
    text('segment-duration',`${time_text(s.end-s.start)} → ${time_text(segment_duration(s))}`);update_rate();
}
function render_timeline():void {
    if(!file)return;const total=project_duration(project),track=$('timeline-track');track.replaceChildren();
    project.segments.forEach((s,i)=>{
        const b=document.createElement('button');b.className=`timeline-segment${selected===i?' selected':''}`;b.style.flex=String(segment_duration(s));b.setAttribute('aria-label',`区間 ${i+1}、${Math.round(s.speed*100)}パーセント`);b.setAttribute('aria-pressed',String(selected===i));
        b.innerHTML=`<i class="edge"></i><span>${String(i+1).padStart(2,'0')} ${s.mode==='follow'?'連動':s.mode==='custom'?`${s.pitch>0?'+':''}${s.pitch} st`:'音程保持'}</span><b>${s.speed.toFixed(2)}×</b><i class="edge right"></i>`;
        b.addEventListener('click',()=>select_segment(i));track.append(b);
    });
    $('time-ticks').replaceChildren();for(let i=0;i<=4;i++){const span=document.createElement('span');span.textContent=time_text(total*i/4);$('time-ticks').append(span);}
    text('segment-count',`${project.segments.length}区間`);text('original-duration',time_text(project.duration));text('output-duration',time_text(total));text('total-time',time_text(total));
    const diff=total-project.duration;text('duration-diff',`${diff>0?'+':''}${diff.toFixed(1)}秒`);$('timeline-cursor').hidden=false;update_player();
}
function render_segment_list():void {
    const list=$('segment-list');if(!file)return;list.replaceChildren();
    project.segments.forEach((s,i)=>{const row=document.createElement('button');row.className=`segment-row${i===selected?' active':''}`;row.setAttribute('aria-pressed',String(i===selected));row.setAttribute('aria-label',`区間 ${i+1} を選択`);const n=document.createElement('b'),detail=document.createElement('span'),range=document.createElement('small'),speed=document.createElement('strong');n.textContent=String(i+1).padStart(2,'0');detail.textContent=s.mode==='custom'?`音程 ${s.pitch>0?'+':''}${s.pitch} 半音`:s.mode==='follow'?'音程は速度に連動':'音程を保持';range.textContent=`${time_text(s.start)} → ${time_text(s.end)}`;detail.append(range);speed.textContent=`${Math.round(s.speed*1000)/10}%`;row.append(n,detail,speed);row.onclick=()=>select_segment(i);list.append(row);});
}
function render():void {
    const ready=!!file;
    for(const id of ['export-open','play-btn','back-frame','next-frame','loop-btn','split-btn','trim-start','trim-end','trim-apply','project-save','project-load','apply-all','render-preview','compare-btn'])($(id) as HTMLButtonElement).disabled=!ready||working;
    $<HTMLButtonElement>('delete-btn').disabled=!ready||project.segments.length<=1||working;
    $<HTMLButtonElement>('undo-btn').disabled=!past.length||working;$<HTMLButtonElement>('redo-btn').disabled=!future.length||working;
    for(const id of ['speed-input','pitch-input','gain-input','apply-fps','speed-minus','speed-plus','pitch-minus','pitch-plus','reset-speed'])($(id) as HTMLInputElement).disabled=!ready||working;
    if(ready){render_settings();render_timeline();render_segment_list();}
}
function update_player():void {
    if(!file)return;const total=project_duration(project),t=clamp(current_output(),0,total),ratio=total?t/total:0;
    text('current-time',time_text(t));$('scrub-fill').style.width=`${ratio*100}%`;$('scrub-dot').style.left=`${ratio*100}%`;$('scrub').setAttribute('aria-valuenow',String(Math.round(ratio*100)));
    const track=$('timeline-track'),parent=$('timeline-content')||track.parentElement!;
    $('timeline-cursor').style.left=`${track.offsetLeft+ratio*track.clientWidth}px`;
    const play_state=video.paused?'play':'pause';if($('play-btn').dataset.state!==play_state){$('play-btn').innerHTML=icon(play_state);$('play-btn').dataset.state=play_state;}$('big-play').hidden=!video.paused||!file;
}
async function open_file(next:File):Promise<void> {
    if(working)throw Error('処理を中止してから別の動画を開いてください。');
    const token=++open_token;message('動画を読み込んでいます…');
    const {media_probe,media_poster}=await import('./media');let next_info:media_info_t;
    try{next_info=await media_probe(next);}catch(error){message(`読み込めませんでした。「古い形式の動画を開く」で互換読み込みを試せます。 ${error instanceof Error?error.message:''}`,true);return;}
    if(token!==open_token||working)return;
    video.pause();invalidate_preview();if(source_url)URL.revokeObjectURL(source_url);if(poster_url)URL.revokeObjectURL(poster_url);
    if(result_url)URL.revokeObjectURL(result_url);void remove_temp(result_temp);result_url='';result_temp=null;result_blob=null;$('export-result').hidden=true;
    file=next;info=next_info;project=new_project(info.duration,next.name);project.source_fps=info.fps;selected=0;past=[];future=[];compare=false;
    try {const saved=JSON.parse(localStorage.getItem('tempo-draft')||'null');if(saved?.fingerprint===`${file.name}:${file.size}:${file.lastModified}`){project=validate_project(saved.project,info.duration);message('前回の編集設定を復元しました。');}else message('');}catch{message('');}
    fit_viewer(info.width,info.height);pane_select('adjust');source_url=URL.createObjectURL(file);video.src=source_url;video.poster='';video.load();$('empty-state').hidden=true;$('viewer').classList.add('loaded');$('viewer-badge').hidden=false;
    text('file-title',file.name);text('file-meta',`${info.width} × ${info.height} · 約${info.fps.toFixed(2)} fps · ${info.video_codec.toUpperCase()}${info.channels?` / ${info.audio_codec.toUpperCase()}`:''} · ${bytes(file.size)}`);
    $<HTMLInputElement>('source-fps').value=String(Math.round(info.fps*1000)/1000);$<HTMLInputElement>('export-fps').value=String(Math.round(info.fps*1000)/1000);text('compare-btn','元動画と比較');
    if(!isSecureContext)message('この接続では動画処理機能が制限されています。HTTPS、またはlocalhostで開いてください。映像・音声の無再圧縮コピーは利用できます。');
    else if(!info.video_decodable)message('この端末では映像の再圧縮を利用できません。「映像をそのまま保持」または互換読み込みを利用してください。');
    else if(!info.audio_decodable)message('音声は端末の互換デコーダーで処理します。');
    else if(info.tracks>2)message('主映像と主音声を編集します。追加の音声トラックや字幕は書き出しに含まれません。');
    else if(info.hdr)message('HDR映像です。色を維持するには「映像をそのまま保持」を選んでください。画質指定ではSDRに変換されます。');
    render();save_draft();message(`${next.name} を読み込みました。`,false,true);
    try{const poster=await media_poster(file);if(poster&&token===open_token){poster_url=URL.createObjectURL(poster);video.poster=poster_url;}}catch{}
}
async function toggle_play():Promise<void> {
    if(!file||working)return;
    if(video.paused){if(current_output()>=project_duration(project)-.02)seek_output(0);update_rate();try{await video.play();}catch{message('直接再生できない形式です。「音程込みで確認」でプレビューを作成してください。',true);}}
    else video.pause();update_player();
}
function tick():void {
    tick_handle=0;
    if(file&&!video.paused&&!render_url&&!compare){const t=current_source(),segments=project.segments,s=loop?segments[selected]:segments[Math.max(0,playback_segment())];
        if(loop&&(t>=s.end-.005||t<s.start-.02)){video.currentTime=s.start+(info?.origin||0);}
        else if(!loop){let i=segments.findIndex(x=>t<x.end-.005);if(i<0){video.pause();video.currentTime=segments.at(-1)!.end+(info?.origin||0);}else if(t<segments[i].start-.002)video.currentTime=segments[i].start+(info?.origin||0);}
        update_rate();}
    update_player();if(!video.paused)tick_handle=requestAnimationFrame(tick);
}
function scrub_at(e:PointerEvent):void {if(!file)return;const r=$('scrub').getBoundingClientRect();seek_output((e.clientX-r.left)/r.width*project_duration(project));}
$('scrub').addEventListener('pointerdown',e=>{$('scrub').setPointerCapture(e.pointerId);scrub_at(e);});$('scrub').addEventListener('pointermove',e=>{if($('scrub').hasPointerCapture(e.pointerId))scrub_at(e);});
$('scrub').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();seek_output(current_output()+(e.key==='ArrowRight'?1:-1));}});
video.addEventListener('play',()=>{if(!tick_handle)tick_handle=requestAnimationFrame(tick);});
video.addEventListener('pause',()=>{cancelAnimationFrame(tick_handle);tick_handle=0;update_player();});
video.addEventListener('seeked',update_player);
video.addEventListener('ended',()=>{if(loop){video.currentTime=render_url?0:project.segments[selected].start+(info?.origin||0);void video.play();}});
video.addEventListener('loadedmetadata',()=>{if(video.videoWidth&&video.videoHeight)fit_viewer(video.videoWidth,video.videoHeight);if(!render_url){video.currentTime=project.segments[0].start+(info?.origin||0);}update_player();});
video.addEventListener('error',()=>{if(file&&!working)message('直接再生に対応していない動画です。音程込みプレビュー、または互換読み込みを使用してください。');});
on('open-btn',()=>{compat_mode=false;$('file-input').click();});on('choose-btn',()=>{compat_mode=false;$('file-input').click();});
$<HTMLInputElement>('file-input').addEventListener('change',async e=>{const f=(e.target as HTMLInputElement).files?.[0];(e.target as HTMLInputElement).value='';if(!f)return;try{if(compat_mode)await open_compat(f);else await open_file(f);}catch(error){message(String(error),true);}});
on('sample-btn',async()=>{const response=await fetch('./sample.mp4');if(!response.ok)throw Error('サンプルを読み込めません。');await open_file(new File([await response.blob()],'ReTempo sample.mp4',{type:'video/mp4',lastModified:1}));});
for(const event of ['dragenter','dragover'])document.addEventListener(event,e=>{e.preventDefault();document.body.classList.add('dragover');});
document.addEventListener('dragleave',e=>{if(!(e as DragEvent).relatedTarget)document.body.classList.remove('dragover');});
document.addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragover');const f=e.dataTransfer?.files[0];if(f)void open_file(f).catch(error=>message(String(error),true));});
on('play-btn',toggle_play);on('big-play',toggle_play);on('back-frame',()=>seek_output(current_output()-1/(project.source_fps||30)));on('next-frame',()=>seek_output(current_output()+1/(project.source_fps||30)));
on('loop-btn',()=>{loop=!loop;$('loop-btn').setAttribute('aria-pressed',String(loop));if(loop)seek_output(source_to_output(project,project.segments[selected].start));});
on('mute-btn',()=>{video.muted=!video.muted;$('mute-btn').setAttribute('aria-pressed',String(video.muted));$('mute-btn').innerHTML=icon(video.muted?'muted':'volume');});
on('fullscreen-btn',async()=>{if(document.fullscreenElement)await document.exitFullscreen();else if($('viewer').requestFullscreen)await $('viewer').requestFullscreen();else (video as any).webkitEnterFullscreen?.();});
on('compare-btn',()=>{invalidate_preview();compare=!compare;text('compare-btn',compare?'編集に戻る':'元動画と比較');update_rate();});
on('speed-minus',()=>set_speed(project.segments[selected].speed-.01));on('speed-plus',()=>set_speed(project.segments[selected].speed+.01));on('reset-speed',()=>set_speed(1));
function bind_numeric(id:string,commit:(value:number)=>void):void {
    const input=$<HTMLInputElement>(id),apply=()=>{if(input.value.trim())commit(Number(input.value));};
    input.addEventListener('change',apply);input.addEventListener('blur',apply);
    input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply();input.blur();}});
}
bind_numeric('speed-input',v=>set_speed(v/100));
bind_numeric('pitch-input',set_pitch);
on('pitch-minus',()=>set_pitch(project.segments[selected].pitch-1));on('pitch-plus',()=>set_pitch(project.segments[selected].pitch+1));
bind_numeric('gain-input',value=>{if(Number.isFinite(value))mutate(()=>{project.segments[selected].gain=clamp(value/100,0,2);});});
document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b=>b.addEventListener('click',()=>set_speed(Number(b.dataset.speed)/100)));
document.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>b.addEventListener('click',()=>mutate(()=>{project.segments[selected].mode=b.dataset.mode as pitch_mode_t;})));
on('apply-fps',()=>{const a=Number($<HTMLInputElement>('source-fps').value),b=Number($<HTMLInputElement>('target-fps').value);if(!(a>0&&b>0&&a<=240&&b<=240))throw Error('fpsは1〜240で入力してください。');if(b/a<.125||b/a>8)throw Error('速度は12.5〜800%の範囲で指定してください。');mutate(()=>{project.source_fps=a;project.segments[selected].speed=b/a;});});
on('apply-all',()=>{mutate(()=>{const s=project.segments[selected];for(const seg of project.segments)Object.assign(seg,{speed:s.speed,pitch:s.pitch,mode:s.mode,gain:s.gain});});message('すべての区間に設定を適用しました。',false,true);});
on('split-btn',()=>mutate(()=>{const t=current_source(),i=project.segments.findIndex(s=>t>s.start&&t<s.end);if(i<0||!split_segment(project,i,t))message('区間の途中へ再生位置を移動してから分割してください。');else {selected=i+1;message(`区間を分割しました。区間 ${selected+1} を選択しています。`,false,true);}}));
on('delete-btn',()=>{if(project.segments.length>1)mutate(()=>{project.segments.splice(selected,1);selected=Math.min(selected,project.segments.length-1);seek_output(source_to_output(project,project.segments[selected].start));});});
on('trim-apply',()=>{const start=parse_time($<HTMLInputElement>('trim-start').value),end=parse_time($<HTMLInputElement>('trim-end').value),lo=selected?project.segments[selected-1].end:0,hi=selected<project.segments.length-1?project.segments[selected+1].start:project.duration;if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<.01||start<lo||end>hi+.001)throw Error('区間が重ならない開始・終了時刻を指定してください。');mutate(()=>Object.assign(project.segments[selected],{start,end}));seek_output(source_to_output(project,start));message('選択区間の範囲を変更しました。',false,true);});
on('undo-btn',()=>{if(!past.length)return;future.push(snapshot());project=JSON.parse(past.pop()!);selected=Math.min(selected,project.segments.length-1);invalidate_preview();save_draft();render();});
on('redo-btn',()=>{if(!future.length)return;past.push(snapshot());project=JSON.parse(future.pop()!);selected=Math.min(selected,project.segments.length-1);invalidate_preview();save_draft();render();});
function download_blob(blob:Blob,name:string):void {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
on('project-save',()=>{download_blob(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),`${file!.name}.tempo.json`);message('編集設定を保存用に書き出しました。',false,true);});on('project-load',()=>$('project-input').click());
$<HTMLInputElement>('project-input').addEventListener('change',async e=>{const input=e.target as HTMLInputElement,f=input.files?.[0];input.value='';if(!f||!file)return;try{if(f.size>1024*1024)throw Error('設定ファイルが大きすぎます。');const loaded=validate_project(JSON.parse(await f.text()),project.duration);mutate(()=>{project=loaded;selected=0;});message('編集設定を読み込みました。',false,true);}catch(error){message(String(error),true);}});
document.addEventListener('keydown',e=>{if((e.target as HTMLElement).closest('input,select,textarea,[role=slider]')||document.querySelector('dialog[open]'))return;if(e.code==='Space'){e.preventDefault();void toggle_play();}if(e.key.toLowerCase()==='j')seek_output(current_output()-10);if(e.key.toLowerCase()==='l')seek_output(current_output()+10);if(e.key==='ArrowRight')seek_output(current_output()+1/(project.source_fps||30));if(e.key==='ArrowLeft')seek_output(current_output()-1/(project.source_fps||30));if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo-btn':'undo-btn').click();}if(e.key.toLowerCase()==='s'&&!e.ctrlKey&&!e.metaKey)$('split-btn').click();});
function export_options():export_t {
    const fps=Number($<HTMLInputElement>('export-fps').value);
    if(!Number.isFinite(fps)||fps<1||fps>120)throw Error('出力fpsは1〜120で指定してください。');
    return {format,mode:format==='gif'?'encode':$<HTMLSelectElement>('export-mode').value as export_t['mode'],quality:Number($<HTMLSelectElement>('export-quality').value),width:Number($<HTMLSelectElement>('export-width').value),fps,mute:$<HTMLInputElement>('export-mute').checked,colors:Number($<HTMLSelectElement>('gif-colors').value),loop:Number($<HTMLSelectElement>('gif-loop').value),audio_bitrate:Number($<HTMLSelectElement>('audio-bitrate').value)};
}
function update_export():void {
    const supported=!!info&&can_copy(project)&&['avc','hevc','av1','vp9'].includes(info.video_codec),select=$<HTMLSelectElement>('export-mode');
    select.options[0].disabled=!supported;
    if(!supported)select.value='encode';
    const copy=format==='mp4'&&select.value==='copy';
    $('mp4-options').hidden=format!=='mp4';$('encoding-options').hidden=copy;$('quality-field').hidden=format==='gif';$('gif-options').hidden=format!=='gif';$('audio-options').hidden=format==='gif';
    text('copy-explanation',supported?'映像データを再圧縮せず、表示する時刻だけを変更します。元の画質・解像度を保持します。':'トリミング・区間削除、またはこの映像形式では再圧縮が必要です。');
    text('export-duration',time_text(project_duration(project),true));
    document.querySelectorAll<HTMLElement>('[data-format]').forEach(b=>b.classList.toggle('active',b.dataset.format===format));
    text('export-warning',format==='gif'?'GIFは長い動画ほどファイルが大きくなります。画面を開いたままにしてください。':'書き出し中は画面を開いたままにしてください。端末によってバックグラウンドで一時停止します。');
    if(info?.hdr&&!copy)text('export-warning','この保存方法ではHDRや透過を維持できません。色を維持するには映像をそのまま保持してください。');
}
on('export-open',()=>{update_export();$<HTMLDialogElement>('export-dialog').showModal();});
document.querySelectorAll<HTMLElement>('[data-format]').forEach(b=>b.addEventListener('click',()=>{if(working)return;format=b.dataset.format as 'mp4'|'gif';if(format==='gif'){$<HTMLSelectElement>('export-width').value='640';$<HTMLInputElement>('export-fps').value='15';}else{$<HTMLInputElement>('export-fps').value=String(Math.min(120,Math.round(project.source_fps*1000)/1000));}update_export();}));
$('export-mode').addEventListener('change',update_export);
async function lock_screen():Promise<void>{try{wake=await navigator.wakeLock?.request('screen');}catch{}}
function set_working(value:boolean):void {if(value)++open_token;working=value;document.body.classList.toggle('is-working',value);render();$<HTMLButtonElement>('export-start').disabled=value;for(const el of $('export-dialog').querySelectorAll<HTMLSelectElement|HTMLInputElement>('select,input'))el.disabled=value;if(value)void lock_screen();else {void wake?.release();wake=null;update_export();}}
async function run_job(p:project_t,options:export_t,preview=false):Promise<{blob:Blob;temp:string|null}>
{
    if(active_job)throw Error('別の処理が進行しています。');
    video.pause();set_working(true);const worker=new Worker(new URL('./export-worker.ts',import.meta.url),{type:'module'});active_job=worker;
    if(preview){$('busy-strip').hidden=false;text('busy-label','プレビューを作成中');}else{$('export-progress').hidden=false;$('export-cancel').hidden=false;$('export-result').hidden=true;}
    try{return await new Promise((resolve,reject)=>{
        worker.onmessage=e=>{const m=e.data;if(m.type==='notice'){message(m.message);return;}if(m.type==='decode-audio'){void import('./audio-bridge').then(x=>x.audio_window_decode(m.buffer,m.sample_rate,m.channels)).then(planes=>{if(active_job===worker)worker.postMessage({type:'decode-audio-result',id:m.id,planes},planes.map(p=>p.buffer));}).catch(error=>{if(active_job===worker)worker.postMessage({type:'decode-audio-result',id:m.id,error:`この音声は端末の音声処理でも読み込めませんでした。${error instanceof Error?error.message:String(error)}`});});return;}if(m.type==='progress'){const value=clamp(m.value,0,1);if(preview){$<HTMLProgressElement>('busy-progress').value=value;text('busy-label',`${m.stage} ${Math.round(value*100)}%`);}else{$<HTMLProgressElement>('progress-bar').value=value;text('progress-stage',m.stage);text('progress-percent',`${Math.round(value*100)}%`);}}else if(m.type==='done')resolve(m);else if(m.type==='error'||m.type==='cancelled')reject(Error(m.message||'処理を中止しました。'));};
        worker.onerror=e=>reject(Error(e.message||'処理が停止しました。解像度を下げるか、区間を短くしてください。'));
        worker.postMessage({type:'export',file,project:p,options});
    });}finally{worker.terminate();active_job=null;set_working(false);$('busy-strip').hidden=true;$('export-cancel').hidden=true;}
}
on('export-start',async()=>{
    if(!file||working)return;message('');
    const options=export_options();
    if(options.format==='gif'&&options.fps>50)throw Error('GIFの出力fpsは50以下にしてください。');
    try {
        const result=await run_job(structuredClone(project),options);if(result_url)URL.revokeObjectURL(result_url);await remove_temp(result_temp);
        result_blob=result.blob;result_temp=result.temp;result_url=URL.createObjectURL(result.blob);
        const a=$<HTMLAnchorElement>('download-link');a.href=result_url;a.download=file.name.replace(/\.[^.]+$/,'')+`-tempo.${format}`;
        text('result-size',bytes(result.blob.size));text('progress-stage','書き出し完了');text('progress-percent','100%');$<HTMLProgressElement>('progress-bar').value=1;$('export-result').hidden=false;$('share-btn').hidden=!navigator.share;message(`${format.toUpperCase()}を書き出しました。ファイルを保存できます。`,false,true);
    }catch(error){text('progress-stage',error instanceof Error?error.message:String(error));message(error instanceof Error?error.message:String(error),true);}
});
async function share_result():Promise<void> {
    if(!result_blob||working)return;
    const f=new File([result_blob],$<HTMLAnchorElement>('download-link').download,{type:result_blob.type});
    if(navigator.canShare?.({files:[f]}))await navigator.share({files:[f]});else message('このブラウザではファイル共有に対応していません。「ファイルを保存」を使ってください。');
}
on('share-btn',share_result);
function cancel_job():void {active_job?.postMessage({type:'cancel'});void import('./compat').then(m=>m.compat_cancel());text('progress-stage','中止しています…');}
on('export-cancel',cancel_job);on('busy-cancel',cancel_job);
$<HTMLDialogElement>('export-dialog').addEventListener('cancel',e=>{if(working)e.preventDefault();});
$<HTMLDialogElement>('export-dialog').querySelector('form')!.addEventListener('submit',e=>{if(working)e.preventDefault();});
on('render-preview',async()=>{
    if(!file||working)return;invalidate_preview();compare=false;text('compare-btn','元動画と比較');
    const s=project.segments[selected],p=structuredClone(project),start=clamp(current_source(),s.start,Math.max(s.start,s.end-.1));
    p.segments=[{...s,start,end:Math.min(s.end,start+10*s.speed)}];
    const result=await run_job(p,{format:'mp4',mode:'encode',quality:25,width:640,fps:24,mute:false,colors:256,loop:0,audio_bitrate:192000},true);
    render_url=URL.createObjectURL(result.blob);render_temp=result.temp;render_start=start;render_base=source_to_output(project,start);render_duration=project_duration(p);video.src=render_url;video.playbackRate=1;video.volume=1;video.load();text('preview-hint','選択区間の最大10秒を、音程込みで確認しています');update_rate();$('pane-player').scrollIntoView({block:'start',behavior:'smooth'});message('音程込みのプレビューを作成しました。',false,true);
});
async function open_compat(f:File):Promise<void> {
    set_working(true);$('busy-strip').hidden=false;video.pause();
    try{const {compat_convert}=await import('./compat');const converted=await compat_convert(f,(value,label)=>{text('busy-label',label);$<HTMLProgressElement>('busy-progress').value=value;});set_working(false);await open_file(converted);message('互換形式に変換しました。変換時に映像・音声は再圧縮されています。');}finally{set_working(false);$('busy-strip').hidden=true;}
}
function action_dialog(title:string,html:string):void {text('action-title',title);$('action-body').innerHTML=html;$<HTMLDialogElement>('action-dialog').showModal();}
on('compat-btn',()=>{action_dialog('古い形式の動画を開く','<p>AVI・WMV・FLV・MPEGなどを追加の変換エンジンでMP4に変換します。映像と音声は再圧縮されます。</p><p>初回は約32MBの追加ダウンロードが必要です。動画自体は端末内で処理します。メモリ使用量が増えるため、入力は128MBまでです。</p><button class="primary" id="compat-choose">動画を選んで互換変換</button>');on('compat-choose',()=>{$<HTMLDialogElement>('action-dialog').close();compat_mode=true;$('file-input').click();});});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&working)void lock_screen();save_draft();});
window.addEventListener('beforeunload',e=>{if(working){e.preventDefault();e.returnValue='';}});
if('serviceWorker'in navigator && !import.meta.env.DEV)navigator.serviceWorker.register('./sw.js').catch(()=>{});
async function clear_stale():Promise<void>{try{const root=await navigator.storage.getDirectory();for await(const [name,entry]of (root as any).entries()){if(name.startsWith('tempo-')&&name.endsWith('.tmp')&&entry.kind==='file'){const f=await entry.getFile();if(Date.now()-f.lastModified>86400000)await root.removeEntry(name);}}}catch{}}
void clear_stale();render();

function fit_viewer(width:number,height:number):void {
    if(!(width>0&&height>0))return;
    $('viewer').style.aspectRatio=`${width} / ${height}`;
    $('viewer').style.width=`min(100%, ${Math.round(360*width/height)}px)`;
}
let tap_time=0,tap_x=0,tap_y=0,tap_side=0,last_x=0,last_y=0,last_skip=0,seek_timer=0;
function skip_seconds(delta:number):void {
    if(!file||working)return;
    seek_output(current_output()+delta);
    const feedback=$('seek-feedback');feedback.textContent=delta<0?'↶ 10秒':'10秒 ↷';feedback.dataset.side=delta<0?'left':'right';feedback.hidden=false;
    clearTimeout(seek_timer);seek_timer=window.setTimeout(()=>feedback.hidden=true,650);
}
$('viewer').addEventListener('pointerdown',e=>{if(!e.isPrimary){tap_time=0;return;}tap_x=e.clientX;tap_y=e.clientY;});
$('viewer').addEventListener('pointercancel',()=>{tap_time=0;});
$('viewer').addEventListener('pointerup',e=>{
    if(!e.isPrimary||!file||working||(e.target as HTMLElement).closest('button')||Math.hypot(e.clientX-tap_x,e.clientY-tap_y)>15)return;
    const rect=$('viewer').getBoundingClientRect(),fraction=(e.clientX-rect.left)/rect.width,side=fraction<.4?-1:fraction>.6?1:0,now=performance.now();
    if(side&&side===tap_side&&now-tap_time<350&&Math.hypot(e.clientX-last_x,e.clientY-last_y)<50){e.preventDefault();skip_seconds(side*10);tap_time=0;last_skip=now;}else{tap_time=now;tap_side=side;last_x=e.clientX;last_y=e.clientY;}
});
$('viewer').addEventListener('touchend',e=>{if(performance.now()-last_skip<150&&e.cancelable)e.preventDefault();},{passive:false});
$('viewer').addEventListener('dblclick',e=>{if(file)e.preventDefault();});
