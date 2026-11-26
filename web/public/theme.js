// Shared page behaviour: light/dark theme, floating nav, reveal on scroll, headline word animation, count-up numbers.
(() => {
  const root = document.documentElement;
  const store = { get: () => { try { return localStorage.getItem("cg-theme"); } catch { return null; } }, set: (v) => { try { localStorage.setItem("cg-theme", v); } catch {} } };
  const current = () => root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.querySelectorAll(".theme").forEach((b) => b.addEventListener("click", () => { const next = current() === "dark" ? "light" : "dark"; root.dataset.theme = next; store.set(next); }));

  const nav = document.querySelector(".nav");
  if (nav) {
    // Hide the nav while scrolling down, bring it back on any scroll up (or near the top).
    let lastY = scrollY;
    const onScroll = () => {
      const y = scrollY, d = y - lastY;
      nav.classList.toggle("scrolled", y > 10);
      if (nav.classList.contains("open") || y < 120) nav.classList.remove("hide");
      else if (d > 6) nav.classList.add("hide");
      else if (d < -6) nav.classList.remove("hide");
      if (Math.abs(d) > 6) lastY = y;
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
    nav.querySelector(".menu")?.addEventListener("click", () => nav.classList.toggle("open"));
    nav.querySelectorAll(".nav-links a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("open")));
  }

  // Screenshot helper: ?shot=<section id> jumps straight to a section with reveals settled.
  { const q = new URLSearchParams(location.search).get("shot"); if (q) root.classList.add("shot"); if (q === "all") { root.style.scrollBehavior = "auto"; addEventListener("load", () => { document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")); document.querySelector(".nav")?.classList.add("hide"); }); } else if (q && q !== "1") { root.style.scrollBehavior = "auto"; addEventListener("load", () => { document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")); const el = document.getElementById(q); if (el) { const r = el.getBoundingClientRect(); scrollTo(0, Math.max(0, r.top + scrollY - Math.max(0, (innerHeight - r.height) / 2))); } document.querySelector(".nav")?.classList.add("hide"); }); } }
  // Headline: each word rises in, one after another.
  document.querySelectorAll("[data-words]").forEach((h) => {
    let i = 0;
    const walk = (node) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const part of n.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.append(part); continue; }
            const s = document.createElement("span"); s.className = "w"; s.style.animationDelay = (0.08 * i++ + 0.05) + "s"; s.textContent = part; frag.append(s);
          }
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      }
    };
    walk(h);
  });

  // Reveal sections as they scroll into view.
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }) : null;
  window.cgReveal = (el) => { if (io) io.observe(el); else el.classList.add("in"); };
  document.querySelectorAll(".reveal").forEach(window.cgReveal);

  // Count numbers up when they appear. Use data-count on an element whose text is the final value.
  window.cgCount = (el) => {
    const m = el.textContent.trim().match(/^([^\d]*)([\d,.]+)(.*)$/); if (!m) return;
    const target = Number(m[2].replace(/,/g, "")); if (!Number.isFinite(target)) return;
    const dec = (m[2].split(".")[1] ?? "").length, t0 = performance.now(), dur = 1400;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = target * e;
      el.textContent = m[1] + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("en-US")) + m[3]; if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const co = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { window.cgCount(e.target); co.unobserve(e.target); } }), { threshold: 0.5 }) : null;
  document.querySelectorAll("[data-count]").forEach((el) => co?.observe(el));
})();
