import { clamp } from './model';
export type ruler_t={set:(v:number)=>void;destroy:()=>void};
export function ruler_create(root:HTMLElement,kind:'speed'|'pitch',change:(v:number,commit:boolean)=>void):ruler_t
{
    const canvas=document.createElement('canvas');root.append(canvas);
    const ctx=canvas.getContext('2d')!;
    let value=kind==='speed'?100:0,drag=false,x0=0,v0=0;
    const position=(v:number)=>kind==='speed'?Math.log2(v/100):v;
    const inverse=(v:number)=>kind==='speed'?100*2**v:v;
    const scale=()=>kind==='speed'?120:24;
    const rounded=(v:number)=>Math.round(clamp(v,kind==='speed'?12.5:-24,kind==='speed'?800:24)*10)/10;
    function draw():void {
        const w=root.clientWidth,h=root.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
        if(!w)return;
        canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
        const step=kind==='speed'?.125:.5,center=position(value),lo=Math.floor((center-w/2/scale())/step),hi=Math.ceil((center+w/2/scale())/step);
        ctx.textAlign='center';ctx.font='11px -apple-system, sans-serif';
        for(let i=lo;i<=hi;i++) {
            const at=i*step,v=inverse(at);if(v<(kind==='speed'?12.5:-24)-.01 || v>(kind==='speed'?800:24)+.01)continue;
            const x=w/2+(at-center)*scale(),major=i%4===0,mid=i%2===0;
            ctx.fillStyle=major?'#8b6e4f':'#d8bfa4';ctx.fillRect(Math.round(x),5,1,major?23:mid?16:10);
            if(major){ctx.fillStyle='#79624b';ctx.fillText(kind==='speed'?`${Math.round(v)}%`:`${v>0?'+':''}${v}`,x,48);}
        }
        root.setAttribute('aria-valuenow',String(value));root.setAttribute('aria-valuetext',`${value}${kind==='speed'?'パーセント':'半音'}`);
    }
    function update(v:number,commit:boolean):void {value=rounded(v);draw();change(value,commit);}
    root.addEventListener('pointerdown',e=>{drag=true;x0=e.clientX;v0=position(value);root.setPointerCapture(e.pointerId);root.focus();});
    root.addEventListener('pointermove',e=>{if(drag)update(inverse(v0-(e.clientX-x0)/scale()),false);});
    function end(e:PointerEvent):void {
        if(!drag)return;drag=false;
        if(Math.abs(e.clientX-x0)<4){const rect=root.getBoundingClientRect();update(inverse(v0+(e.clientX-rect.left-rect.width/2)/scale()),true);}else change(value,true);
    }
    root.addEventListener('pointerup',end);root.addEventListener('pointercancel',()=>{drag=false;change(value,true);});
    root.addEventListener('wheel',e=>{if(document.activeElement!==root)return;e.preventDefault();update(value+(e.deltaY>0?-1:1)*(kind==='speed'?1:.1),true);},{passive:false});
    root.addEventListener('keydown',e=>{let delta=0;if(['ArrowLeft','ArrowDown'].includes(e.key))delta=-1;if(['ArrowRight','ArrowUp'].includes(e.key))delta=1;if(!delta)return;e.preventDefault();update(value+delta*(e.shiftKey?.1:1),true);});
    const observer=new ResizeObserver(draw);observer.observe(root);draw();
    return {set(v){value=v;draw();},destroy(){observer.disconnect();}};
}
