// GARGANTUA - global hotkeys (single owner of keyboard input)

export class Input {
  constructor(actions) {
    this.actions = actions;
    this._handler = (e) => this._onKey(e);
    window.addEventListener('keydown', this._handler);
  }

  _onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const a = this.actions;

    // digits via physical key code: Shift+1..4 = presets, 0..9 = debug views
    if (/^Digit\d$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      if (e.shiftKey && n >= 1 && n <= 4) a.setPreset?.(n - 1);
      else if (!e.shiftKey) a.setDebug?.(n);
      e.preventDefault();
      return;
    }

    const k = e.key;
    switch (k) {
      case '[': a.cyclePreset?.(-1); break;
      case ']': a.cyclePreset?.(1); break;
      case 'c': case 'C': a.toggleCinematic?.(); break;
      case ' ': a.togglePause?.(); e.preventDefault(); break;
      case 'p': case 'P': a.togglePanel?.(); break;
      case 'h': case 'H': a.toggleHud?.(); break;
      case 'm': case 'M': a.toggleAudio?.(); break;
      case 's': case 'S': a.screenshot?.(); break;
      case 'f': case 'F': a.toggleFullscreen?.(); break;
      case 'r': case 'R': a.resetParams?.(); break;
      case 'q': case 'Q': a.setQuality?.('standard'); break;
      case 'w': case 'W': a.setQuality?.('high'); break;
      case 'e': case 'E': a.setQuality?.('cinematic'); break;
      case '?': case '/': a.toggleHelp?.(); break;
      case 'Escape': a.escape?.(); break;
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._handler);
  }
}
