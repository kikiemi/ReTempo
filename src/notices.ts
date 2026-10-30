export type notice_kind_t='info'|'success'|'error';
type notice_t={kind:notice_kind_t;body:string;time:string};
const history:notice_t[]=[];
let last='',last_at=0;
export function notice_post(body:string,kind:notice_kind_t='info'):void {
    if(!body)return;
    const now=Date.now();if(body===last&&now-last_at<1200)return;last=body;last_at=now;
    const entry={body,kind,time:new Date(now).toLocaleTimeString('ja-JP',{hour12:false})};
    history.unshift(entry);if(history.length>60)history.pop();
    const status=document.getElementById('last-event');if(status)status.textContent=body;
    const count=document.getElementById('log-count');if(count)count.textContent=String(history.length);
    const root=document.getElementById('toast-stack')!;
    root.dataset.kind=kind;root.title=body;
    notice_render();
}
export function notice_render():void {
    const root=document.getElementById('log-list');if(!root)return;root.replaceChildren();
    if(!history.length){const empty=document.createElement('p');empty.className='log-empty';empty.textContent='まだ通知はありません。操作の完了やエラーをここに残します。';root.append(empty);return;}
    for(const entry of history){const row=document.createElement('li');row.className=`log-item log-${entry.kind}`;const time=document.createElement('time'),body=document.createElement('p'),label=document.createElement('span');time.textContent=entry.time;label.textContent=entry.kind==='error'?'エラー':entry.kind==='success'?'完了':'情報';body.textContent=entry.body;row.append(time,label,body);root.append(row);}
}
export function notice_clear():void {history.length=0;document.getElementById('log-count')!.textContent='0';notice_render();}
