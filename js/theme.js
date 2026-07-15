/* ============ থিম (ডার্ক / হোয়াইট) ============ */
(function () {
  const saved = localStorage.getItem('reelhub_theme');
  const theme = saved === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
})();

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('reelhub_theme', theme);
  document.querySelectorAll('.seg-switch button[data-theme-btn]').forEach(b => {
    b.classList.toggle('active', b.dataset.themeBtn === theme);
  });
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  setTheme(current === 'light' ? 'dark' : 'light');
}
document.addEventListener('DOMContentLoaded', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  document.querySelectorAll('.seg-switch button[data-theme-btn]').forEach(b => {
    b.classList.toggle('active', b.dataset.themeBtn === current);
  });
});
