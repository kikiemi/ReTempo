# Third-party notices

Tempo Studio's original application code, UI and generated sample are dedicated under CC0 1.0 Universal. Dependencies retain their own licenses. CC0 does not replace those licenses.

| Component | Version | License | Upstream |
|---|---|---|---|
| Mediabunny | 1.60.0 | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| @mediabunny/aac-encoder | 1.60.0 | MPL-2.0, with an FFmpeg AAC encoder | https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder |
| gifenc | 1.0.3 | MIT | https://github.com/mattdesl/gifenc |
| @ffmpeg/ffmpeg | 0.12.15 | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/util | 0.12.2 | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/core, optional download | 0.12.10 | FFmpeg and enabled component licenses, including GPL components such as x264 | https://github.com/ffmpegwasm/ffmpeg.wasm |

Full MPL, MIT and LGPL texts are in `public/licenses/` and are also served at `licenses/` in the built application. Copyright notices are retained there. Original dependency source files and upstream build instructions are provided in `public/licenses/third-party-source.zip`, under their original licenses; their upstream comments and notices are intentionally preserved. These are third-party files, not application code.

Mediabunny and its AAC extension are used without source modifications. The AAC extension includes a WebAssembly FFmpeg AAC encoder. Its upstream README and C bridge, included in the source archive, document rebuilding with Emscripten and linking against FFmpeg's libavcodec/libavutil. FFmpeg source and license information are available at https://ffmpeg.org/download.html and https://ffmpeg.org/legal.html. The AAC-only configuration in the upstream build recipe does not enable GPL components. Replacement builds can be used by replacing the extension package and rebuilding this app; the application imposes no restriction on modification or reverse engineering for debugging such replacement library versions.

Exact JavaScript package distributions, including upstream source:

- https://registry.npmjs.org/mediabunny/-/mediabunny-1.60.0.tgz
- https://registry.npmjs.org/@mediabunny/aac-encoder/-/aac-encoder-1.60.0.tgz
- https://registry.npmjs.org/gifenc/-/gifenc-1.0.3.tgz
- https://registry.npmjs.org/@ffmpeg/ffmpeg/-/ffmpeg-0.12.15.tgz
- https://registry.npmjs.org/@ffmpeg/util/-/util-0.12.2.tgz

The full compatibility FFmpeg core is not bundled in the default distribution. Users opt into downloading it when selecting compatibility conversion. It is distinct from the small AAC-only extension. If redistributing a self-hosted compatibility core, preserve its upstream license notices and corresponding source/build requirements. The optional download script retrieves the unmodified @ffmpeg/core 0.12.10 ESM build from jsDelivr.

Build dependencies are listed in package-lock.json and are not included in the static application.

Noroemon was consulted as a visual reference. This application's editor, player, controls and processing implementation were written separately. The CC0 legal text is the standard CC0 1.0 Universal license.
