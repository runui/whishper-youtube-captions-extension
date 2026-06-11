type WhishperTrackDetail = {
  language?: string;
  cueCount?: number;
  json3?: YoutubeTimedText;
};

type YoutubeTimedText = {
  wireMagic: string;
  events: Array<{
    tStartMs: number;
    dDurationMs: number;
    segs: Array<{ utf8: string }>;
  }>;
};

type YoutubeCaptionTrack = {
  languageCode: string;
  languageName: string;
  displayName: string;
  kind: string;
  name: string;
  id: string;
  is_servable: boolean;
  is_default: boolean;
  is_translateable: boolean;
  vss_id: string;
  baseUrl: string;
  url: string;
};

type YoutubePlayer = HTMLElement & {
  __whishperCaptionsPatched?: boolean;
  getOption?: (namespace: string, option?: string) => unknown;
  setOption?: (namespace: string, option: string, value: unknown) => unknown;
  getAudioTrack?: () => unknown;
  getAvailableAudioTracks?: () => unknown;
};

type YoutubePlayerInternals = Record<string, unknown> & {
  __whishperCaptionsPatched?: boolean;
  cD?: (store: unknown, track: unknown) => unknown;
  Re?: (store: unknown, includeAsr?: boolean) => unknown;
  uq?: new (track: Record<string, unknown>) => unknown;
};

let whishperTrack: YoutubeCaptionTrack | undefined;
let whishperTimedText: YoutubeTimedText | undefined;
let selected = false;
const WHISHPER_LANGUAGE = 'en';
const WHISHPER_TRACK_NAME = 'whishper';
const WHISHPER_VSS_ID = '.en.whishper';
const WHISHPER_TIMEDTEXT_URL = `https://www.youtube.com/api/timedtext?whishper=1&fmt=json3&lang=${WHISHPER_LANGUAGE}&name=${WHISHPER_TRACK_NAME}`;

export default defineContentScript({
  matches: ['*://youtube.com/*', '*://www.youtube.com/*', '*://*.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    whishperTrack = createWhishperTrack();
    whishperTimedText = { wireMagic: 'pb3', events: [] };
    patchYtPlayerInternalsEntrypoint();
    patchPlayerResponseEntrypoints();

    window.addEventListener('whishper-captions-track-ready', (event) => {
      const detail = (event as CustomEvent<WhishperTrackDetail>).detail ?? {};
      whishperTimedText = detail.json3;
      whishperTrack = createWhishperTrack();
      selected = true;
      patchPlayer();
      reloadWhishperCaptions();
    });

    patchTimedTextRequests();
    setInterval(patchYtPlayerInternals, 500);
    setInterval(patchPlayerResponseEntrypoints, 500);
    setInterval(patchPlayer, 500);
    patchYtPlayerInternals();
    patchPlayer();
  }
});

function patchYtPlayerInternalsEntrypoint() {
  const target = window as typeof window & Record<string, unknown>;
  if (target.__whishperYtPlayerInternalsEntrypointPatched) return;

  target.__whishperYtPlayerInternalsEntrypointPatched = true;
  let value = target._yt_player;
  try {
    Object.defineProperty(window, '_yt_player', {
      configurable: true,
      get() {
        return value;
      },
      set(nextValue) {
        value = nextValue;
        patchYtPlayerInternals();
      }
    });
  } catch {
    target.__whishperYtPlayerInternalsEntrypointPatched = false;
  }
}

function patchYtPlayerInternals() {
  const internals = (window as typeof window & { _yt_player?: YoutubePlayerInternals })._yt_player;
  if (!internals || internals.__whishperCaptionsPatched || typeof internals.cD !== 'function') return;

  internals.__whishperCaptionsPatched = true;
  const originalAddCaptionTrack = internals.cD.bind(internals);
  const originalReadCaptionTracks = typeof internals.Re === 'function' ? internals.Re.bind(internals) : undefined;
  internals.cD = (store: unknown, track: unknown) => {
    const result = originalAddCaptionTrack(store, track);
    if (!isInternalWhishperTrack(track)) addWhishperToInternalCaptionStore(internals, originalAddCaptionTrack, store);
    return result;
  };

  if (originalReadCaptionTracks) {
    internals.Re = (store: unknown, includeAsr?: boolean) => {
      addWhishperToInternalCaptionStore(internals, originalAddCaptionTrack, store);
      return originalReadCaptionTracks(store, includeAsr);
    };
  }
}

function addWhishperToInternalCaptionStore(
  internals: YoutubePlayerInternals,
  addCaptionTrack: (store: unknown, track: unknown) => unknown,
  store: unknown
) {
  if (!internals.uq || !store || typeof store !== 'object') return;
  const captionStore = store as { Y?: unknown[]; C?: unknown[] };
  const tracks = [...(Array.isArray(captionStore.Y) ? captionStore.Y : []), ...(Array.isArray(captionStore.C) ? captionStore.C : [])];
  if (tracks.some(isInternalWhishperTrack)) return;

  addCaptionTrack(store, new internals.uq(createWhishperInternalTrack()));
}

function createWhishperInternalTrack() {
  return {
    id: WHISHPER_TRACK_NAME,
    languageCode: WHISHPER_LANGUAGE,
    languageName: 'Whishper',
    displayName: 'Whishper',
    name: null,
    kind: '',
    is_servable: true,
    is_default: false,
    is_translateable: false,
    vss_id: WHISHPER_VSS_ID,
    url: WHISHPER_TIMEDTEXT_URL
  };
}

function isInternalWhishperTrack(track: unknown) {
  return typeof track === 'object' && track !== null && 'id' in track && track.id === WHISHPER_TRACK_NAME;
}

function patchPlayerResponseEntrypoints() {
  patchInitialPlayerResponse();
  patchYtplayerBootstrap();
}

function patchInitialPlayerResponse() {
  const key = '__whishperInitialPlayerResponsePatched';
  const target = window as typeof window & Record<string, unknown>;
  if (target.ytInitialPlayerResponse) target.ytInitialPlayerResponse = addWhishperToPlayerResponse(target.ytInitialPlayerResponse);
  if (target[key]) return;

  target[key] = true;
  let value = target.ytInitialPlayerResponse;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() {
        return value;
      },
      set(nextValue) {
        value = addWhishperToPlayerResponse(nextValue);
      }
    });
  } catch {
    target[key] = false;
  }
}

function patchYtplayerBootstrap() {
  const ytplayer = (window as typeof window & { ytplayer?: Record<string, unknown> }).ytplayer;
  if (!ytplayer || ytplayer.__whishperBootstrapPatched) return;

  ytplayer.__whishperBootstrapPatched = true;
  if (ytplayer.bootstrapPlayerResponse) ytplayer.bootstrapPlayerResponse = addWhishperToPlayerResponse(ytplayer.bootstrapPlayerResponse);
  if (ytplayer.config && typeof ytplayer.config === 'object') {
    const config = ytplayer.config as Record<string, unknown>;
    if (config.args && typeof config.args === 'object') {
      const args = config.args as Record<string, unknown>;
      if (typeof args.player_response === 'string') {
        try {
          args.player_response = JSON.stringify(addWhishperToPlayerResponse(JSON.parse(args.player_response)));
        } catch {
          // Keep YouTube's original serialized response if parsing fails.
        }
      }
    }
  }
}

function patchTimedTextRequests() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isWhishperTimedTextRequest(input)) return Promise.resolve(timedTextResponse());
    const response = await originalFetch(input, init);
    if (!isYoutubePlayerRequest(input)) return response;

    try {
      const json = await response.clone().json();
      return new Response(JSON.stringify(addWhishperToPlayerResponse(json)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch {
      return response;
    }
  };

  const OriginalXMLHttpRequest = window.XMLHttpRequest;
  window.XMLHttpRequest = class WhishperXMLHttpRequest extends OriginalXMLHttpRequest {
    private whishperUrl = '';

    override open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
      this.whishperUrl = String(url);
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4 || !isYoutubePlayerUrl(this.whishperUrl)) return;
        try {
          const modified = JSON.stringify(addWhishperToPlayerResponse(JSON.parse(super.responseText)));
          Object.defineProperty(this, 'responseText', { value: modified });
          Object.defineProperty(this, 'response', { value: modified });
        } catch {
          // Keep YouTube's original response if it is not JSON or if Chrome marks it read-only.
        }
      });
      return super.open(method, url, async ?? true, username ?? null, password ?? null);
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null) {
      if (!isWhishperTimedTextUrl(this.whishperUrl)) return super.send(body);
      selected = true;
      window.dispatchEvent(new CustomEvent('whishper-captions-select'));
      setTimeout(() => {
        Object.defineProperty(this, 'readyState', { value: 4 });
        Object.defineProperty(this, 'status', { value: 200 });
        Object.defineProperty(this, 'responseText', { value: timedTextJson() });
        Object.defineProperty(this, 'response', { value: timedTextJson() });
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new Event('load'));
        this.dispatchEvent(new Event('loadend'));
      });
      return undefined;
    }
  };
}

function reloadWhishperCaptions() {
  const player = document.querySelector<YoutubePlayer>('#movie_player');
  if (!player || !whishperTrack) return;
  try {
    player.setOption?.('captions', 'reload', true);
  } catch {
    // Not all player builds expose reload as a writable captions option.
  }
  try {
    player.setOption?.('captions', 'track', whishperTrack);
  } catch {
    // The patched setOption below still keeps the Whishper selection state.
  }
}

function isYoutubePlayerRequest(input: RequestInfo | URL) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  return isYoutubePlayerUrl(url);
}

function isYoutubePlayerUrl(url: string) {
  return url.includes('/youtubei/v1/player');
}

function addWhishperToPlayerResponse(response: unknown) {
  if (!whishperTrack || typeof response !== 'object' || response === null) return response;
  const data = response as {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<Record<string, unknown>>;
      };
    };
  };
  data.captions ??= {};
  data.captions.playerCaptionsTracklistRenderer ??= {};
  const renderer = data.captions?.playerCaptionsTracklistRenderer;
  if (!renderer) return response;
  renderer.captionTracks ??= [];
  renderer.captionTracks = addWhishperToCaptionTrackList(renderer.captionTracks);
  return data;
}

function createWhishperTrack(): YoutubeCaptionTrack {
  return {
    languageCode: WHISHPER_LANGUAGE,
    languageName: 'Whishper',
    displayName: 'Whishper',
    kind: '',
    name: 'Whishper',
    id: 'whishper',
    is_servable: true,
    is_default: false,
    is_translateable: false,
    vss_id: WHISHPER_VSS_ID,
    baseUrl: WHISHPER_TIMEDTEXT_URL,
    url: WHISHPER_TIMEDTEXT_URL
  };
}

function isWhishperTimedTextRequest(input: RequestInfo | URL) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  return isWhishperTimedTextUrl(url);
}

function isWhishperTimedTextUrl(url: string) {
  return url.includes('/api/timedtext') && url.includes('whishper=1');
}

function timedTextResponse() {
  selected = true;
  window.dispatchEvent(new CustomEvent('whishper-captions-select'));
  return new Response(timedTextJson(), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function timedTextJson() {
  return JSON.stringify(whishperTimedText ?? { wireMagic: 'pb3', events: [] });
}

function patchPlayer() {
  const player = document.querySelector<YoutubePlayer>('#movie_player');
  if (!player || player.__whishperCaptionsPatched || typeof player.getOption !== 'function') return;

  player.__whishperCaptionsPatched = true;
  const originalGetOption = player.getOption.bind(player);
  const originalSetOption = typeof player.setOption === 'function' ? player.setOption.bind(player) : undefined;
  const originalGetAudioTrack = typeof player.getAudioTrack === 'function' ? player.getAudioTrack.bind(player) : undefined;
  const originalGetAvailableAudioTracks = typeof player.getAvailableAudioTracks === 'function' ? player.getAvailableAudioTracks.bind(player) : undefined;

  player.getOption = (namespace: string, option?: string) => {
    const value = originalGetOption(namespace, option);
    if (namespace === 'captions' && option === 'tracklist' && whishperTrack) {
      const list = Array.isArray(value) ? value : [];
      return list.some((track) => isWhishperTrack(track)) ? list : [...list, whishperTrack];
    }
    if (namespace === 'captions' && option === 'track' && selected && whishperTrack) return whishperTrack;
    return value;
  };

  player.setOption = (namespace: string, option: string, value: unknown) => {
    if (namespace === 'captions' && option === 'track' && isWhishperTrack(value)) {
      selected = true;
      window.dispatchEvent(new CustomEvent('whishper-captions-select'));
      return undefined;
    }
    if (namespace === 'captions' && option === 'track') {
      selected = false;
      window.dispatchEvent(new CustomEvent('whishper-captions-deselect'));
    }
    return originalSetOption?.(namespace, option, value);
  };

  if (originalGetAudioTrack) {
    player.getAudioTrack = () => addWhishperToAudioTrack(originalGetAudioTrack());
  }

  if (originalGetAvailableAudioTracks) {
    player.getAvailableAudioTracks = () => {
      const tracks = originalGetAvailableAudioTracks();
      if (!Array.isArray(tracks)) return tracks;
      return tracks.map((track) => addWhishperToAudioTrack(track));
    };
  }
}

function addWhishperToAudioTrack(audioTrack: unknown) {
  if (!whishperTrack || typeof audioTrack !== 'object' || audioTrack === null) return audioTrack;
  const track = audioTrack as Record<string, unknown>;
  for (const key of ['captionTracks', 'captionsInitialState']) {
    if (Array.isArray(track[key])) {
      track[key] = addWhishperToCaptionTrackList(track[key] as Array<Record<string, unknown>>);
    }
  }
  return track;
}

function addWhishperToCaptionTrackList(captionTracks: Array<Record<string, unknown>>) {
  return [...captionTracks.filter((track) => track.vssId !== WHISHPER_VSS_ID && track.trackName !== WHISHPER_TRACK_NAME), createWhishperResponseTrack(captionTracks)];
}

function createWhishperResponseTrack(captionTracks: Array<Record<string, unknown>> = []) {
  return {
    baseUrl: createWhishperTimedTextUrl(captionTracks),
    name: { simpleText: 'Whishper' },
    vssId: WHISHPER_VSS_ID,
    languageCode: WHISHPER_LANGUAGE,
    isTranslatable: false,
    trackName: WHISHPER_TRACK_NAME
  };
}

function createWhishperTimedTextUrl(captionTracks: Array<Record<string, unknown>>) {
  const sourceUrl = captionTracks.find((track) => typeof track.baseUrl === 'string')?.baseUrl as string | undefined;
  if (!sourceUrl) return WHISHPER_TIMEDTEXT_URL;

  try {
    const url = new URL(sourceUrl);
    url.searchParams.set('name', WHISHPER_TRACK_NAME);
    url.searchParams.set('fmt', 'json3');
    url.searchParams.set('whishper', '1');
    url.searchParams.delete('kind');
    return url.toString();
  } catch {
    return WHISHPER_TIMEDTEXT_URL;
  }
}

function isWhishperTrack(value: unknown): value is YoutubeCaptionTrack {
  return typeof value === 'object' && value !== null && 'id' in value && value.id === 'whishper';
}
