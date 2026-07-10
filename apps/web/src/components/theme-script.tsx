/**
 * Inlined before paint to set the theme class from localStorage / system
 * preference — avoids a flash of the wrong theme (FOUC).
 */
export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
