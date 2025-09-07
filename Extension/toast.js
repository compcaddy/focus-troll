// Simple toast notifications for the popup
// Usage: Toast.show('Saved', { type: 'success' })
(function () {
  const defaults = {
    duration: 2200,
    type: 'success', // 'success' | 'error' | 'info'
  };

  function ensureContainer() {
    let c = document.getElementById('ft-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'ft-toast-container';
      c.className = 'fixed z-50 top-4 right-4 flex flex-col gap-2';
      document.body.appendChild(c);
    }
    return c;
  }

  function classByType(type) {
    switch (type) {
      case 'error':
        return 'bg-red-600 text-white';
      case 'info':
        return 'bg-neutral-800 text-white';
      case 'success':
      default:
        return 'bg-p1 text-white';
    }
  }

  function show(message, options = {}) {
    const opts = { ...defaults, ...(options || {}) };
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = `${classByType(opts.type)} shadow-lg rounded-lg px-4 py-2 text-sm font-semibold opacity-0 transform transition-all duration-200 translate-y-2`;
    el.textContent = message;
    container.appendChild(el);
    // Enter
    requestAnimationFrame(() => {
      el.classList.remove('opacity-0', 'translate-y-2');
      el.classList.add('opacity-100', 'translate-y-0');
    });
    // Exit
    setTimeout(() => {
      el.classList.remove('opacity-100', 'translate-y-0');
      el.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => el.remove(), 220);
    }, opts.duration);
  }

  window.Toast = { show };
})();

