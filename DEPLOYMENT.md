# 斷罪塔發布版

This website serves the supplied SinTower_GitHubPages release export, without editing controls.
Upload index.html, .nojekyll, game/runtime-v152.bin and the entire media folder together. Do not normalize or edit the binary data.

Original website is retained in Git history at 731c651a1987cd059e232773ba6a863c0779cbdf.
The startup runtime is now 410,858 compressed bytes (1,734,052 bytes after decompression), instead of a 281 MB HTML document. Fifty-five MIME-preserving media files total 140,338,578 bytes, fetched on demand and cached independently. All media bytes are identical to the previous embedded assets. The actor default remains 0.68. The loader uses a Blob document rather than duplicating a huge srcdoc string. Original source export is updated with the same lossless media-extraction pipeline.
The monochrome dot progress screen remains over initialization until published gameplay is ready. Its percentage combines bytes and timed estimated progress (one point per four seconds), not download percentage alone; 100% requires a playable scene. Failures/timeouts offer a retry icon without prose.
