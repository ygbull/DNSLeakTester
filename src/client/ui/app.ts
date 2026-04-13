import type { ScanResults } from '../scanner/types';
import type { ShareableResults } from './share';
import { runAllTests } from '../scanner/runner';
import { renderProgress } from './progress';
import { renderReportCard, renderGradeGauge } from './report';
import { shareResults, checkForSharedResults } from './share';
import { showToast } from '../utils/dom';

type AppState = 'idle' | 'scanning' | 'results' | 'shared' | 'error';

const VALID_VERDICTS = ['pass', 'warn', 'fail', 'error'];

const ERROR_MESSAGES = {
  network: {
    icon: '\u26A0',
    title: 'Network Error',
    body: 'Could not connect to the analysis server. Check your internet connection and try again.',
  },
  timeout: {
    icon: '\u23F1',
    title: 'Scan Timed Out',
    body: 'The scan took too long to complete. This may be due to a slow connection or the DNS test service being unavailable.',
  },
  service: {
    icon: '\u26D4',
    title: 'Service Unavailable',
    body: 'The DNS leak test service (bash.ws) is currently unreachable. Other tests may still work.',
  },
};

export class App {
  private state: AppState = 'idle';
  private results: ScanResults | null = null;
  private abortController: AbortController | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelHandler = () => this.cancelScan();
  private scanGeneration = 0;

  init(): void {
    document.getElementById('btn-scan')!.addEventListener('click', () => this.startScan());
    document.getElementById('btn-rescan')!.addEventListener('click', () => this.reset());
    document.getElementById('btn-share')!.addEventListener('click', () => this.share());

    const shared = checkForSharedResults();
    if (shared) {
      this.showSharedResults(shared);
      return;
    }
  }

  getState(): AppState { return this.state; }

  async startScan(): Promise<void> {
    if (this.state === 'scanning') return;
    if (this.state === 'error') {
      document.getElementById('progress-container')!.innerHTML = '';
    }

    const gen = ++this.scanGeneration;
    this.abortController = new AbortController();

    const cancelBtn = document.getElementById('btn-cancel')!;
    cancelBtn.removeEventListener('click', this.cancelHandler);
    cancelBtn.addEventListener('click', this.cancelHandler, { once: true });

    // Ripple effect
    const scanBtn = document.getElementById('btn-scan')!;
    scanBtn.classList.add('scanning');
    setTimeout(() => scanBtn.classList.remove('scanning'), 600);

    this.setState('scanning');

    try {
      for await (const progress of runAllTests(this.abortController.signal)) {
        renderProgress(document.getElementById('progress-container')!, progress);
        if (progress.testsComplete === progress.testsTotal && progress.results.overallGrade) {
          this.results = progress.results as ScanResults;
          this.showResults(this.results);
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof TypeError) {
        this.renderError('network');
      } else {
        this.renderError('timeout');
      }
      this.setState('error');
    } finally {
      if (this.scanGeneration === gen) {
        document.getElementById('btn-cancel')!.removeEventListener('click', this.cancelHandler);
      }
    }
  }

  cancelScan(): void {
    this.abortController?.abort();
    this.setState('idle');
    showToast('Scan cancelled');
  }

  reset(): void {
    history.replaceState(null, '', window.location.pathname);
    this.results = null;
    document.getElementById('report-container')!.innerHTML = '';
    document.getElementById('progress-container')!.innerHTML = '';
    this.setState('idle');
  }

  share(): void {
    if (this.results) shareResults(this.results);
  }

  private showResults(results: ScanResults): void {
    const container = document.getElementById('report-container')!;
    renderReportCard(container, results);
    this.setState('results');
  }

  private showSharedResults(shared: ShareableResults): void {
    const container = document.getElementById('report-container')!;
    container.innerHTML = '';

    // Shared banner
    const banner = document.createElement('div');
    banner.className = 'shared-banner';
    const date = new Date(shared.t);
    const bannerTitle = document.createElement('p');
    bannerTitle.className = 'shared-banner-title';
    bannerTitle.textContent = `You're viewing shared results from ${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    banner.appendChild(bannerTitle);

    const runOwn = document.createElement('a');
    runOwn.href = window.location.pathname;
    runOwn.textContent = 'Run your own scan';
    banner.appendChild(runOwn);
    container.appendChild(banner);

    // Grade
    container.appendChild(renderGradeGauge(shared.g as 'A' | 'B' | 'C' | 'D' | 'F'));

    // Shared test cards
    const tests = [
      { key: 'i', name: 'IP & Geo' },
      { key: 'd', name: 'DNS Leak' },
      { key: 'w', name: 'WebRTC Leak' },
      { key: 'l', name: 'TLS Analysis' },
      { key: 'f', name: 'Browser Fingerprint' },
    ] as const;

    for (const { key, name } of tests) {
      const test = shared[key];
      const card = document.createElement('div');
      card.className = 'test-card';

      const verdictClass = VALID_VERDICTS.includes(test.v) ? test.v : 'error';

      const header = document.createElement('div');
      header.className = 'test-card-header';
      header.innerHTML = `<span class="verdict-badge ${verdictClass}">${verdictClass.toUpperCase()}</span>`;

      const title = document.createElement('span');
      title.className = 'test-card-title';
      title.textContent = name;
      header.appendChild(title);

      const summary = document.createElement('div');
      summary.className = 'test-card-summary';
      summary.textContent = test.s;

      card.appendChild(header);
      card.appendChild(summary);
      container.appendChild(card);
    }

    this.setState('shared');
  }

  private setState(newState: AppState): void {
    // Cancel any pending transition from a previous setState call
    if (this.transitionTimer !== null) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
      // The cleared timer would have hidden a section — hide all now.
      // The correct section will be un-hidden below.
      for (const id of ['state-idle', 'state-scanning', 'state-results']) {
        const el = document.getElementById(id);
        if (el) {
          el.classList.remove('fade-out', 'fade-in');
          el.classList.add('hidden');
        }
      }
    } else {
      // Remove stale transition classes even when no timer was pending
      for (const id of ['state-idle', 'state-scanning', 'state-results']) {
        document.getElementById(id)?.classList.remove('fade-out', 'fade-in');
      }
    }

    const stateMap: Record<string, string> = {
      idle: 'state-idle',
      scanning: 'state-scanning',
      results: 'state-results',
      shared: 'state-results',
      error: 'state-scanning',
    };

    const oldSection = document.getElementById(stateMap[this.state]);
    const newSection = document.getElementById(stateMap[newState]);

    if (oldSection && oldSection !== newSection) {
      if (this.state === 'idle' && newState === 'shared') {
        // Skip fade on initial shared results load
        oldSection.classList.add('hidden');
        if (newSection) {
          newSection.classList.remove('hidden');
          newSection.classList.add('fade-in');
        }
      } else {
        oldSection.classList.add('fade-out');
        this.transitionTimer = setTimeout(() => {
          this.transitionTimer = null;
          oldSection.classList.add('hidden');
          oldSection.classList.remove('fade-out');
          if (newSection) {
            newSection.classList.remove('hidden');
            newSection.classList.add('fade-in');
          }
        }, 350);
      }
    } else if (newSection) {
      newSection.classList.remove('hidden');
      newSection.classList.add('fade-in');
    }

    this.state = newState;
  }

  private renderError(type: keyof typeof ERROR_MESSAGES): void {
    const container = document.getElementById('progress-container')!;
    const msg = ERROR_MESSAGES[type];
    container.innerHTML = '';

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-state';

    const icon = document.createElement('div');
    icon.className = 'error-icon';
    icon.textContent = msg.icon;

    const title = document.createElement('div');
    title.className = 'error-title';
    title.textContent = msg.title;

    const body = document.createElement('p');
    body.className = 'error-message';
    body.textContent = msg.body;

    const retry = document.createElement('button');
    retry.className = 'btn-primary error-retry';
    retry.textContent = 'Try Again';
    retry.addEventListener('click', () => this.startScan());

    errorDiv.appendChild(icon);
    errorDiv.appendChild(title);
    errorDiv.appendChild(body);
    errorDiv.appendChild(retry);
    container.appendChild(errorDiv);
  }
}
