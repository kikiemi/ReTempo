function stretch(input:Float32Array[],tempo:number,sr:number):Float32Array[]
{
    const count=input[0].length,nout=Math.max(1,Math.round(count/tempo));
    if(Math.abs(tempo-1)<1e-7)return input.map(x=>x.slice());
    const hop=2**Math.round(Math.log2(sr*.011)),win=hop*2,seek=Math.round(sr*.009);
    const out=input.map(()=>new Float32Array(nout+win)),weight=new Float32Array(nout+win);
    const window=Float32Array.from({length:win},(_,i)=>.5-.5*Math.cos(2*Math.PI*(i+.5)/win));
    let previous=0;
    for(let pos=0,k=0;pos<nout;pos+=hop,k++) {
        let start=Math.min(count-1,Math.round(k*hop*tempo));
        if(k&&start+win<count) {
            const expected=start,ref=previous+hop,lo=Math.max(0,start-seek),hi=Math.min(count-win,start+seek);
            const score=(candidate:number,stride:number):number=>{
                let dot=0,aa=1e-12,bb=1e-12;
                for(let c=0;c<input.length;c++)for(let j=0;j<hop;j+=stride){const a=input[c][ref+j]||0,b=input[c][candidate+j]||0;dot+=a*b;aa+=a*a;bb+=b*b;}
                return dot/Math.sqrt(aa*bb)-.002*Math.abs(candidate-expected)/seek;
            };
            let best=-Infinity;
            for(let candidate=lo;candidate<=hi;candidate+=4){const value=score(candidate,8);if(value>best){best=value;start=candidate;}}
            const coarse=start;best=-Infinity;
            for(let candidate=Math.max(lo,coarse-3);candidate<=Math.min(hi,coarse+3);candidate++){const value=score(candidate,2);if(value>best){best=value;start=candidate;}}
        }
        previous=start;
        for(let j=0;j<win;j++){const w=window[j];weight[pos+j]+=w;for(let c=0;c<input.length;c++)out[c][pos+j]+=(input[c][start+j]||0)*w;}
    }
    return out.map(a=>{const b=a.slice(0,nout);for(let i=0;i<nout;i++)if(weight[i]>1e-8)b[i]/=weight[i];return b;});
}
type filter_t={radius:number;taps:number;phases:number;weights:Float32Array};
const filters=new Map<number,filter_t>();
function filter_get(ratio:number):filter_t {
    const cached=filters.get(ratio);if(cached)return cached;
    const radius=Math.ceil(32*Math.max(1,ratio)),taps=radius*2,phases=512,cutoff=Math.min(1,1/ratio)*.97;
    const weights=new Float32Array((phases+1)*taps);
    for(let p=0;p<=phases;p++){
        let norm=0;
        for(let j=0;j<taps;j++){
            const x=p/phases-(j-radius+1),a=Math.PI*x*cutoff,window=.42+.5*Math.cos(Math.PI*x/radius)+.08*Math.cos(2*Math.PI*x/radius);
            const w=Math.abs(x)>=radius?0:(Math.abs(a)<1e-9?1:Math.sin(a)/a)*window*cutoff;
            weights[p*taps+j]=w;norm+=w;
        }
        for(let j=0;j<taps;j++)weights[p*taps+j]/=norm;
    }
    if(filters.size>=2)filters.delete(filters.keys().next().value!);
    const filter={radius,taps,phases,weights};filters.set(ratio,filter);return filter;
}
export function resample(input:Float32Array[],ratio:number,length:number):Float32Array[]
{
    if(Math.abs(ratio-1)<1e-7)return input.map(a=>{const b=new Float32Array(length);b.set(a.subarray(0,length));return b;});
    const out=input.map(()=>new Float32Array(length)),filter=filter_get(ratio),{radius,taps,phases,weights}=filter;
    for(let i=0;i<length;i++){
        const t=i*ratio,center=Math.floor(t),phase=(t-center)*phases,p=Math.floor(phase),mix=phase-p,base=p*taps;
        for(let j=0;j<taps;j++){
            const w=weights[base+j]*(1-mix)+weights[base+taps+j]*mix,index=Math.max(0,Math.min(input[0].length-1,center+j-radius+1));
            for(let c=0;c<input.length;c++)out[c][i]+=(input[c][index]||0)*w;
        }
    }
    return out;
}
export function audio_transform(input:Float32Array[],speed:number,pitch:number,sr:number):Float32Array[]
{
    if(!input.length||!Number.isFinite(speed)||!Number.isFinite(pitch)||!Number.isFinite(sr)||sr<=0||speed<=0||pitch<=0)throw Error('音声の設定が不正です。');
    const length=Math.max(1,Math.round(input[0].length/speed));
    return resample(stretch(input,speed/pitch,sr),pitch,length);
}
