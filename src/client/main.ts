import './styles/main.css';
import { App } from './ui/app';

const app = new App();
app.init();

// Keyboard shortcuts
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  switch (e.key) {
    case '?':      toggleKeyboardHelp(); break;
    case 'r':      if (app.getState() === 'results') app.reset(); break;
    case 's':      if (app.getState() === 'results') app.share(); break;
    case 'Enter':  if (app.getState() === 'idle' || app.getState() === 'error') app.startScan(); break;
    case 'Escape':
      if (document.querySelector('.keyboard-help')) {
        toggleKeyboardHelp();
      } else if (app.getState() === 'scanning') {
        app.cancelScan();
      }
      break;
  }
});

function toggleKeyboardHelp(): void {
  const existing = document.querySelector('.keyboard-help');
  if (existing) {
    existing.remove();
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'keyboard-help';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const content = document.createElement('div');
  content.className = 'keyboard-help-content';

  const heading = document.createElement('h3');
  heading.textContent = 'Keyboard Shortcuts';

  const dl = document.createElement('dl');
  const shortcuts = [
    ['Enter', 'Start scan'],
    ['Esc', 'Cancel scan / Close'],
    ['r', 'Rescan'],
    ['s', 'Share results'],
    ['?', 'Toggle this help'],
  ];

  for (const [key, desc] of shortcuts) {
    const dt = document.createElement('dt');
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    dt.appendChild(kbd);
    const dd = document.createElement('dd');
    dd.textContent = desc;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  content.appendChild(heading);
  content.appendChild(dl);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
}
