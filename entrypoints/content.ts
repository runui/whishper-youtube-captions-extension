import '../assets/content.css';

type Segment = {
  start: number;
  end: number;
  text: string;
};

type Transcription = {
  id: string;
  status: number;
  sourceUrl: string;
  result?: {
    language?: string;
    segments?: Segment[];
    text?: string;
  };
  translations?: Translation[];
};

type Translation = {
  sourceLanguage: string;
  targetLanguage: string;
  translationStatus: number;
  result?: {
    language?: string;
    segments?: Segment[];
    text?: string;
  };
};

type Settings = {
  apiHost: string;
  language: string;
  targetLanguage: string;
  modelSize: string;
  device: 'cpu' | 'cuda';
  pollIntervalMs: number;
};

type StorageArea = {
  get(defaults?: Record<string, unknown> | string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type ExtensionApi = {
  storage: {
    local: StorageArea;
    sync: StorageArea;
  };
};

const DONE = 2;
const ERROR = -1;
const DEFAULT_SETTINGS: Settings = {
  apiHost: 'http://localhost:8082',
  language: 'auto',
  targetLanguage: '',
  modelSize: 'base',
  device: 'cpu',
  pollIntervalMs: 5000
};

let root: HTMLDivElement | undefined;
let shadow: ShadowRoot | undefined;
let captionEl: HTMLDivElement | undefined;
let statusEl: HTMLDivElement | undefined;
let actionButton: HTMLButtonElement | undefined;
let segments: Segment[] = [];
let currentVideoId = '';
let currentJobId = '';
let pollTimer: number | undefined;
let rafId: number | undefined;
let started = false;

export default defineContentScript({
  matches: ['*://youtube.com/*', '*://www.youtube.com/*', '*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    start();
  }
});

function start() {
  if (started) return;
  started = true;
  ensureUi();
  listenForYoutubeCaptionSelection();
  observeNavigation();
  void syncForCurrentPage();
}

function observeNavigation() {
  let href = location.href;
  setInterval(() => {
    if (href === location.href) return;
    href = location.href;
    void syncForCurrentPage();
  }, 1000);
}

async function syncForCurrentPage() {
  const videoId = getVideoId();
  if (!videoId) {
    setStatus('Open a YouTube video to use Whishper captions.');
    setCaption('');
    return;
  }

  if (videoId === currentVideoId) return;
  stopPolling();
  segments = [];
  removeNativeTrack();
  currentJobId = '';
  currentVideoId = videoId;
  setCaption('');
  setStatus('Ready to request local Whishper subtitles.');
  await restoreCachedJob(videoId);
}

function ensureUi() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'whishper-youtube-captions-host';
  shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <section class="panel" aria-live="polite">
      <div class="brand">Whishper captions</div>
      <div class="status">Loading...</div>
      <button type="button">Transcribe this video</button>
    </section>
    <div class="caption" aria-live="polite"></div>
  `;
  document.documentElement.append(root);
  statusEl = shadow.querySelector<HTMLDivElement>('.status') ?? undefined;
  captionEl = shadow.querySelector<HTMLDivElement>('.caption') ?? undefined;
  actionButton = shadow.querySelector<HTMLButtonElement>('button') ?? undefined;
  actionButton?.addEventListener('click', () => void startTranscription());
  startCaptionLoop();
}

async function startTranscription() {
  const videoId = getVideoId();
  if (!videoId) {
    setStatus('No YouTube video detected.');
    return;
  }

  const settings = await getSettings();
  setBusy(true);
  setStatus('Creating Whishper transcription job...');

  try {
    const transcription = await createTranscription(settings, location.href);
    currentJobId = transcription.id;
    await extensionApi().storage.local.set({ [jobKey(videoId)]: currentJobId });
    setStatus('Whishper is transcribing. Captions will appear when ready.');
    pollTranscription(settings, transcription.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to create transcription job.');
    setBusy(false);
  }
}

async function restoreCachedJob(videoId: string) {
  const settings = await getSettings();
  const cached = await extensionApi().storage.local.get(jobKey(videoId));
  const jobId = cached[jobKey(videoId)];
  if (typeof jobId !== 'string' || jobId.length === 0) return;
  currentJobId = jobId;
  setStatus('Found an existing Whishper job. Checking status...');
  pollTranscription(settings, jobId);
}

async function createTranscription(settings: Settings, sourceUrl: string): Promise<Transcription> {
  const form = new FormData();
  form.set('sourceUrl', sourceUrl);
  form.set('language', settings.language);
  form.set('modelSize', settings.modelSize);
  form.set('device', settings.device);

  const response = await fetch(`${trimSlash(settings.apiHost)}/api/transcriptions`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    throw new Error(`Whishper API rejected the request (${response.status}).`);
  }
  return response.json() as Promise<Transcription>;
}

function pollTranscription(settings: Settings, jobId: string) {
  stopPolling();
  setBusy(true);

  const poll = async () => {
    try {
      const transcription = await getTranscription(settings, jobId);
      if (transcription.status === DONE && transcription.result?.segments?.length) {
        const captionResult = await resolveCaptionResult(settings, transcription);
        segments = captionResult.segments;
        const injected = publishWhishperCaptions(segments, captionResult.language);
        setStatus(injected ? `Whishper captions ready (${captionResult.language}).` : `Captions ready (${captionResult.language}).`);
        setBusy(false);
        stopPolling();
        return;
      }

      if (transcription.status === ERROR) {
        setStatus('Whishper failed to transcribe this video.');
        setBusy(false);
        stopPolling();
        return;
      }

      setStatus(statusText(transcription.status));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to reach Whishper API.');
      setBusy(false);
      stopPolling();
    }
  };

  void poll();
  pollTimer = window.setInterval(() => void poll(), settings.pollIntervalMs);
}

async function getTranscription(settings: Settings, jobId: string): Promise<Transcription> {
  const response = await fetch(`${trimSlash(settings.apiHost)}/api/transcriptions/${jobId}`);
  if (!response.ok) {
    throw new Error(`Unable to load Whishper job (${response.status}).`);
  }
  return response.json() as Promise<Transcription>;
}

async function resolveCaptionResult(settings: Settings, transcription: Transcription) {
  const targetLanguage = normalizeTargetLanguage(settings.targetLanguage);
  if (!targetLanguage) {
    return {
      language: transcription.result?.language ?? 'auto',
      segments: transcription.result?.segments ?? []
    };
  }

  const existing = findTranslation(transcription, targetLanguage);
  if (existing?.result?.segments?.length) {
    return {
      language: existing.targetLanguage,
      segments: existing.result.segments
    };
  }

  setStatus(`Translating Whishper captions to ${targetLanguage}...`);
  await translateTranscription(settings, transcription.id, targetLanguage);
  const translation = await waitForTranslation(settings, transcription.id, targetLanguage);
  if (!translation?.result?.segments?.length) {
    throw new Error(`Whishper translation to ${targetLanguage} is not available yet.`);
  }

  return {
    language: translation.targetLanguage,
    segments: translation.result.segments
  };
}

async function waitForTranslation(settings: Settings, jobId: string, targetLanguage: string) {
  const attempts = Math.max(1, Math.ceil(30000 / settings.pollIntervalMs));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const transcription = await getTranscription(settings, jobId);
    const translation = findTranslation(transcription, targetLanguage);
    if (translation?.result?.segments?.length) return translation;
    await delay(Math.min(settings.pollIntervalMs, 3000));
  }
  return undefined;
}

async function translateTranscription(settings: Settings, jobId: string, targetLanguage: string) {
  const response = await fetch(`${trimSlash(settings.apiHost)}/api/translate/${jobId}/${encodeURIComponent(targetLanguage)}`);
  if (!response.ok && response.status !== 304) {
    throw new Error(`Unable to translate Whishper captions to ${targetLanguage} (${response.status}).`);
  }
}

function findTranslation(transcription: Transcription, targetLanguage: string) {
  const targets = new Set([targetLanguage, libreTranslateLanguage(targetLanguage)]);
  return transcription.translations?.find((translation) => targets.has(translation.targetLanguage));
}

function startCaptionLoop() {
  const tick = () => {
    setCaption('');
    rafId = requestAnimationFrame(tick);
  };

  if (rafId === undefined) rafId = requestAnimationFrame(tick);
}

function stopPolling() {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

async function getSettings(): Promise<Settings> {
  const stored = await extensionApi().storage.sync.get(DEFAULT_SETTINGS);
  return {
    apiHost: String(stored.apiHost || DEFAULT_SETTINGS.apiHost),
    language: String(stored.language || DEFAULT_SETTINGS.language),
    targetLanguage: String(stored.targetLanguage || DEFAULT_SETTINGS.targetLanguage),
    modelSize: String(stored.modelSize || DEFAULT_SETTINGS.modelSize),
    device: stored.device === 'cuda' ? 'cuda' : 'cpu',
    pollIntervalMs: Number(stored.pollIntervalMs || DEFAULT_SETTINGS.pollIntervalMs)
  };
}

function setBusy(isBusy: boolean) {
  if (!actionButton) return;
  actionButton.disabled = isBusy;
  actionButton.textContent = isBusy ? 'Waiting for Whishper...' : 'Transcribe this video';
}

function setStatus(message: string) {
  if (statusEl) statusEl.textContent = message;
}

function setCaption(text: string) {
  if (!captionEl) return;
  captionEl.textContent = text;
  captionEl.toggleAttribute('data-visible', text.length > 0);
}

function publishWhishperCaptions(nextSegments: Segment[], language: string) {
  announceWhishperTrack(language, nextSegments);
  return true;
}

function removeNativeTrack() {
  document.querySelectorAll('video.html5-main-video track[data-whishper-captions="true"]').forEach((track) => track.remove());
}

function listenForYoutubeCaptionSelection() {
  window.addEventListener('whishper-captions-select', () => {
    setCaption('');
    if (segments.length === 0 && !pollTimer) void startTranscription();
  });
}

function announceWhishperTrack(language: string, nextSegments: Segment[]) {
  window.dispatchEvent(
    new CustomEvent('whishper-captions-track-ready', {
      detail: {
        language: normalizeTrackLanguage(language),
        cueCount: nextSegments.length,
        json3: toYoutubeJson3(nextSegments)
      }
    })
  );
}

function toYoutubeJson3(nextSegments: Segment[]) {
  return {
    wireMagic: 'pb3',
    events: nextSegments.map((segment) => ({
      tStartMs: Math.round(segment.start * 1000),
      dDurationMs: Math.max(1, Math.round((segment.end - segment.start) * 1000)),
      segs: [{ utf8: segment.text.trim() }]
    }))
  };
}

function normalizeTrackLanguage(language: string) {
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(language) ? language : 'und';
}

function normalizeTargetLanguage(language: string) {
  const value = language.trim();
  return value === '' || value === 'original' || value === 'auto' ? '' : value;
}

function libreTranslateLanguage(language: string) {
  return language === 'zh' ? 'zh-Hans' : language;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getVideoId() {
  const url = new URL(location.href);
  return url.hostname.includes('youtube.com') && url.pathname === '/watch' ? url.searchParams.get('v') ?? '' : '';
}

function jobKey(videoId: string) {
  return `whishper-job:${videoId}`;
}

function trimSlash(value: string) {
  return value.replace(/\/$/, '');
}

function statusText(status: number) {
  if (status === 0) return 'Whishper job is queued.';
  if (status === 1) return 'Whishper is transcribing this video.';
  return `Whishper job status: ${status}.`;
}

function extensionApi() {
  const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
  if (!api) throw new Error('Extension API is unavailable.');
  return api;
}
