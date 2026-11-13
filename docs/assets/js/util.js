/* ฟังก์ชันช่วยเหลือเล็ก ๆ ที่ทุกหน้าใช้ร่วมกัน */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toastHost() {
    let h = document.querySelector(".toast-host");
    if (!h) { h = document.createElement("div"); h.className = "toast-host"; document.body.appendChild(h); }
    return h;
  }
  function toast(msg, type, ms) {
    const h = toastHost();
    const t = document.createElement("div");
    t.className = "toast " + (type || "");
    t.textContent = msg;
    h.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .25s"; setTimeout(() => t.remove(), 280); }, ms || 2800);
  }

  const fmt = (n) => Number(n || 0).toLocaleString("th-TH");
  const pad2 = (n) => String(n).padStart(2, "0");

  function param(name) { return new URLSearchParams(location.search).get(name); }

  function shapes(i) { return ["▲", "◆", "●", "■", "★", "⬢"][i % 6]; }

  function publicUrl() {
    const cfg = window.QUIZ_CONFIG || {};
    if (cfg.PUBLIC_URL) return cfg.PUBLIC_URL.replace(/\/$/, "");
    const p = location.pathname.replace(/\/[^/]*$/, "/");
    return location.origin + p;
  }
  function joinUrl(pin) { return publicUrl() + "play.html?pin=" + encodeURIComponent(pin); }

  function qrSvg(text, size) {
    // ต้องโหลด vendor/qrcode.js ก่อน
    if (typeof qrcode !== "function") return "";
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  function initials(name) { return String(name || "?").trim().charAt(0).toUpperCase(); }

  window.U = { $, $$, esc, toast, fmt, pad2, param, shapes, publicUrl, joinUrl, qrSvg, initials };
})();
