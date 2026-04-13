import type { ScanProgress } from '../scanner/types';

const STEPS = [
  { id: 'network', label: 'Network Analysis' },
  { id: 'webrtc',  label: 'WebRTC Leak Test' },
  { id: 'fingerprint', label: 'Browser Fingerprint' },
  { id: 'dns',     label: 'DNS Leak Test' },
  { id: 'grade',   label: 'Computing Results' },
];

export function renderProgress(container: HTMLElement, progress: ScanProgress): void {
  // Create scaffold on first render
  if (!container.querySelector('.radar')) {
    const radar = document.createElement('div');
    radar.className = 'radar';
    radar.innerHTML = '<div class="radar-ring"></div><div class="radar-center"></div>';

    const steps = document.createElement('div');
    steps.className = 'progress-steps';

    const preview = document.createElement('div');
    preview.className = 'skeleton-preview';
    preview.innerHTML = `
      <div class="skeleton skeleton-circle"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    `;

    container.appendChild(radar);
    container.appendChild(steps);
    container.appendChild(preview);
  }

  // Update step indicators
  const stepsContainer = container.querySelector('.progress-steps')!;
  stepsContainer.innerHTML = '';

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    const isComplete = progress.testsComplete > i;
    const isActive = progress.testsComplete === i;

    const el = document.createElement('div');
    el.className = `progress-step${isComplete ? ' complete' : ''}${isActive ? ' active' : ''}`;

    const icon = document.createElement('span');
    icon.className = 'progress-step-icon';
    if (isComplete) icon.textContent = '\u2713';

    const label = document.createElement('span');
    label.className = 'progress-step-label';
    label.textContent = step.label;

    el.appendChild(icon);
    el.appendChild(label);
    stepsContainer.appendChild(el);
  }
}
