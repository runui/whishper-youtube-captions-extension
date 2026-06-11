import { browser } from 'wxt/browser';

type Device = 'cpu' | 'cuda';

const defaults = {
  apiHost: 'http://localhost:8082',
  language: 'auto',
  targetLanguage: '',
  modelSize: 'base',
  device: 'cpu' as Device,
  pollIntervalMs: 5000
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <section>
      <p class="eyebrow">Whishper YouTube Captions</p>
      <h1>Use your local backend as YouTube captions.</h1>
      <p class="intro">The content script submits the current YouTube URL to Whishper and overlays returned segments on the player.</p>
    </section>

    <form>
      <label>
        Backend API host
        <input name="apiHost" placeholder="http://localhost:8082" />
      </label>

      <label>
        Language
        <input name="language" placeholder="auto, en, zh..." />
      </label>

      <label>
        Subtitle target language
        <input name="targetLanguage" placeholder="blank for original, zh, fr, ja..." />
      </label>

      <label>
        Model size
        <select name="modelSize">
          <option value="tiny">tiny</option>
          <option value="base">base</option>
          <option value="small">small</option>
          <option value="medium">medium</option>
          <option value="large">large</option>
        </select>
      </label>

      <label>
        Device
        <select name="device">
          <option value="cpu">cpu</option>
          <option value="cuda">cuda</option>
        </select>
      </label>

      <label>
        Poll interval (ms)
        <input name="pollIntervalMs" min="1000" step="500" type="number" />
      </label>

      <button type="submit">Save settings</button>
      <p class="message" hidden></p>
    </form>
  </main>
`;

const form = document.querySelector<HTMLFormElement>('form')!;
const message = document.querySelector<HTMLParagraphElement>('.message')!;

void loadSettings();

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveSettings();
});

async function loadSettings() {
  const stored = await browser.storage.sync.get(defaults);
  setField('apiHost', String(stored.apiHost || defaults.apiHost));
  setField('language', String(stored.language || defaults.language));
  setField('targetLanguage', String(stored.targetLanguage || defaults.targetLanguage));
  setField('modelSize', String(stored.modelSize || defaults.modelSize));
  setField('device', stored.device === 'cuda' ? 'cuda' : 'cpu');
  setField('pollIntervalMs', String(stored.pollIntervalMs || defaults.pollIntervalMs));
}

async function saveSettings() {
  await browser.storage.sync.set({
    apiHost: getField('apiHost'),
    language: getField('language'),
    targetLanguage: getField('targetLanguage').trim(),
    modelSize: getField('modelSize'),
    device: getField('device') === 'cuda' ? 'cuda' : 'cpu',
    pollIntervalMs: Number(getField('pollIntervalMs') || defaults.pollIntervalMs)
  });

  message.hidden = false;
  message.textContent = 'Saved. Reload the YouTube tab if it is already open.';
}

function getField(name: string) {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement || field instanceof HTMLSelectElement ? field.value : '';
}

function setField(name: string, value: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
}
