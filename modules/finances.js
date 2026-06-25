/**
 * Finances Module — powered by Inner Circle Finance (localhost:3001)
 * Embeds the full finance React app in an iframe with sub-tab navigation.
 */

const FINANCE_URL = 'http://localhost:3001';

const PAGES = [
  { path: '/',              icon: '📊', label: 'Dashboard'    },
  { path: '/budget',        icon: '💰', label: 'Budget'       },
  { path: '/transactions',  icon: '📋', label: 'Transactions' },
  { path: '/sunday',        icon: '☀️', label: 'Sunday'       },
  { path: '/subscriptions', icon: '📺', label: 'Subscriptions'},
  { path: '/paychecks',     icon: '💼', label: 'Paychecks'   },
  { path: '/import',        icon: '⬆️', label: 'Import'      },
];

let _container = null;
let _activePath = '/';
let _moduleViewOverflow = '';

function render() {
  if (!_container) return;

  _container.style.height = '100%';
  _container.style.overflow = 'hidden';

  _container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">

      <!-- Sub-tab bar -->
      <div style="
        display:flex;gap:4px;padding:8px 16px;
        background:var(--bg-surface);
        border-bottom:1px solid var(--separator);
        overflow-x:auto;flex-shrink:0;
        scrollbar-width:none
      ">
        ${PAGES.map(p => `
          <button data-path="${p.path}" style="
            display:inline-flex;align-items:center;gap:5px;
            padding:5px 12px;border-radius:6px;border:none;cursor:pointer;
            font-size:12px;font-weight:600;letter-spacing:0.01em;
            background:${_activePath === p.path ? 'var(--accent,#007AFF)' : 'var(--bg-surface-2)'};
            color:${_activePath === p.path ? 'var(--text-on-accent)' : 'var(--text-secondary)'};
            flex-shrink:0;transition:background 0.12s,color 0.12s;
            white-space:nowrap
          ">${p.icon} ${p.label}</button>
        `).join('')}
      </div>

      <!-- Finance app iframe -->
      <div style="flex:1;overflow:hidden;position:relative">
        <iframe
          id="finance-frame"
          src="${FINANCE_URL}${_activePath}?embed=1"
          style="width:100%;height:100%;border:none;display:block"
          allow="clipboard-write"
        ></iframe>

        <!-- Server-not-running overlay (shown until iframe loads) -->
        <div id="finance-offline" style="
          position:absolute;inset:0;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          background:var(--bg-primary);
          font-family:inherit;pointer-events:none
        ">
          <div style="font-size:36px;margin-bottom:12px">💰</div>
          <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Finance server not running</div>
          <div style="font-size:12px;color:var(--text-secondary);text-align:center;max-width:320px;line-height:1.6">
            Open a Terminal and run:<br>
            <code style="
              display:inline-block;margin-top:6px;padding:4px 10px;
              background:var(--bg-surface-2);border-radius:5px;font-size:11px;
              color:var(--text-primary)
            ">bash ~/Desktop/inner-circle-finance/start.sh</code>
          </div>
        </div>
      </div>

    </div>
  `;

  // Hide offline overlay once the iframe loads successfully
  const iframe = document.getElementById('finance-frame');
  const offline = document.getElementById('finance-offline');
  if (iframe && offline) {
    iframe.addEventListener('load', () => {
      offline.style.display = 'none';
    }, { once: true });
  }

  // Tab navigation
  _container.querySelectorAll('[data-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      _activePath = btn.dataset.path;
      render();
    });
  });
}

export async function init(container) {
  _container = container;
  // Make module-view non-scrolling so the iframe fills it completely
  const mv = document.getElementById('module-view');
  if (mv) { _moduleViewOverflow = mv.style.overflow; mv.style.overflow = 'hidden'; }
  render();
}

export function cleanup() {
  const mv = document.getElementById('module-view');
  if (mv) mv.style.overflow = _moduleViewOverflow;
  if (_container) { _container.style.height = ''; _container.style.overflow = ''; }
  _container = null;
  _activePath = '/';
}
