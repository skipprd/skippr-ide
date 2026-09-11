import { defineSkipprDocs } from '@skippr/vitepress-theme'

export default defineSkipprDocs({
  name: 'Skippr IDE',
  hostname: 'ide.skippr.io',
  description: 'Skippr IDE drives sde, which drives skipprd.',
  nav: [{"text": "Install", "link": "/"}],
  sidebar: {"/": [{"text": "Skippr IDE", "link": "/"}]},
})
