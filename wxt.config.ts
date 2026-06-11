import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Whishper YouTube Captions',
    description: 'Use the local Whishper backend as a YouTube subtitle provider.',
    permissions: ['storage'],
    host_permissions: ['http://*/*', 'https://*/*'],
    options_ui: {
      page: 'options.html',
      open_in_tab: true
    }
  }
});
