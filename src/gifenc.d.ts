declare module 'gifenc' {
 export function GIFEncoder(o?:any):any;
 export function quantize(pixels:Uint8Array|Uint8ClampedArray,n:number,o?:any):number[][];
 export function applyPalette(pixels:Uint8Array|Uint8ClampedArray,palette:number[][],format?:string):Uint8Array;
}
