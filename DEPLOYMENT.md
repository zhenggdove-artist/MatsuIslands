# 斷罪塔發布版

This website serves the supplied SinTower_GitHubPages release export, without editing controls.
Upload index.html, .nojekyll, game/runtime-v152.bin and the entire media folder together. Do not normalize or edit the binary data.

Original website is retained in Git history at 731c651a1987cd059e232773ba6a863c0779cbdf.
The startup runtime is approximately 424 KB compressed, instead of a 281 MB HTML document. Fifty-five MIME-preserving media files total 140,338,578 bytes, fetched on demand and cached independently. All media bytes are identical to the previous embedded assets. The actor default remains 0.68, and the saved authored state is preserved. The loader uses a Blob document rather than duplicating a huge srcdoc string. Original source export is updated with the same lossless media-extraction pipeline.
The monochrome dot progress screen remains over initialization until published gameplay is ready. Its percentage combines bytes and timed estimated progress (one point per four seconds), not download percentage alone; 100% requires a playable scene. Failures/timeouts offer a retry icon without prose.

v153: The loader now waits for scene prop/model construction and reports failures rather than hiding missing objects. Touch event binding uses a non-serialized runtime property (saved data-bound attributes previously prevented all button handlers from attaching); controls remain above the document backdrop. GIFs are decoded in two workers with original dimensions/timing/disposal and shared by source, without an all-frame cache. This works without ImageDecoder. The embedded omggif 1.0.10 decoder is MIT-licensed (copyright/permission notice retained in the runtime). Password smooth-animation predecoding is deferred until its screen is actually open. Runtime requests carry a content-hash query to avoid stale boot code.
