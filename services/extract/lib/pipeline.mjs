import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JobError, wrapStep } from './errors.mjs';
import { timed } from './timing.mjs';
import { fetchMeta, download, probeMedia, thumbnail } from './ytdlp.mjs';
import { putOnce } from './blob.mjs';
import { analyzeVideo } from './gemini.mjs';
import { validateUrl } from './url.mjs';

export const MAX_DURATION_S = 240;

// Ejecuta un trabajo completo: yt-dlp -> Blob -> Gemini. Siempre borra su directorio temporal.
export async function runJob({ config, url, platform, signal }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cwym-'));
  try {
    const { value: got, ms: ytdlpMs } = await timed(async () => {
      const meta = await fetchMeta({ bin: config.ytdlp, url, signal });
      // webpage_url comes back from the extraction: reuse it only if it is still one of the allowed platforms.
      const checked = validateUrl(meta.webpageUrl);
      meta.webpageUrl = checked.ok ? checked.url : url;
      if (meta.durationS != null && meta.durationS > MAX_DURATION_S) {
        throw new JobError('too_long', 413, `duracion ${meta.durationS}s > ${MAX_DURATION_S}s`);
      }
      const mp4 = path.join(dir, `${meta.id}.mp4`);
      await download({ bin: config.ytdlp, url: meta.webpageUrl, outFile: mp4, signal });
      const probe = await probeMedia({ bin: config.ffprobe, file: mp4, signal });
      if (probe.durationS != null && probe.durationS > MAX_DURATION_S) {
        throw new JobError('too_long', 413, `duracion ${probe.durationS}s > ${MAX_DURATION_S}s`);
      }
      if (!/mp4|mov/.test(probe.formatName)) {
        throw new JobError('ytdlp_failed', 502, `formato no mp4: ${probe.formatName}`);
      }
      const thumb = await thumbnail({
        bin: config.ytdlp, ffmpeg: config.ffmpeg, url: meta.webpageUrl, dir, id: meta.id, mp4, signal,
      });
      return { meta, mp4, thumb, durationS: probe.durationS ?? meta.durationS };
    });
    const { meta, mp4, thumb } = got;
    signal?.throwIfAborted();

    // The Blob copy (for playback) and the Gemini analysis do not depend on each other: run them together.
    const blobJob = timed(async () => {
      const video = await wrapStep('blob_failed', 502, () =>
        putOnce({
          token: config.blobToken,
          pathname: `sources/${platform}/${meta.id}.mp4`,
          file: mp4,
          contentType: 'video/mp4',
          signal,
        }),
      );
      const image = thumb
        ? await wrapStep('blob_failed', 502, () =>
            putOnce({
              token: config.blobToken,
              pathname: `sources/${platform}/${meta.id}.jpg`,
              file: thumb,
              contentType: 'image/jpeg',
              signal,
            }),
          )
        : null;
      return { video, image };
    });
    const geminiJob = timed(() =>
      wrapStep('gemini_failed', 502, () =>
        analyzeVideo({
          apiKey: config.geminiKey,
          file: mp4,
          displayName: `${platform}-${meta.id}`,
          signal,
        }),
      ),
    );
    // allSettled so neither job is left running (and the temp dir deleted under it) when the other fails.
    const [blobRes, geminiRes] = await Promise.allSettled([blobJob, geminiJob]);
    if (blobRes.status === 'rejected') throw blobRes.reason;
    if (geminiRes.status === 'rejected') throw geminiRes.reason;
    const { value: blobs, ms: uploadMs } = blobRes.value;
    const { value: analysis, ms: geminiMs } = geminiRes.value;

    return {
      platform,
      id: meta.id,
      url: meta.webpageUrl,
      author: meta.author,
      authorHandle: meta.authorHandle,
      caption: meta.description,
      likes: meta.likes,
      views: meta.views,
      comments: meta.comments,
      durationS: got.durationS,
      videoUrl: blobs.video.url,
      thumbUrl: blobs.image?.url ?? null,
      ...analysis,
      timings: { ytdlpMs, uploadMs, geminiMs },
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
