/* หน้าแรก: ผู้เล่นกรอก PIN / ผู้จัดเข้าสู่ระบบ (เป็นหน้าต่าง popup ไม่ดันหน้าจนต้องเลื่อน) */
(function () {
  const { $, $$, param } = U;
  const pinInput = $("#pin-input");
  let authMode = "login";
  let loggedIn = false;

  /* ---------- ผู้เล่น ---------- */
  // ถ้ามี ?pin= มาจาก QR ให้ข้ามไปหน้าผู้เล่นเลย
  const preset = param("pin");
  if (preset) {
    const p = String(preset).replace(/\D/g, "").slice(0, 6);
    if (p.length === 6) { location.replace("play.html?pin=" + p); return; }
  }

  pinInput.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 6);
    if (pinInput.value.length === 6) setTimeout(() => $("#join-form").requestSubmit(), 120);
  });

  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pin = pinInput.value.replace(/\D/g, "");
    if (pin.length !== 6) { U.toast("PIN ต้องมี 6 หลัก", "err"); pinInput.focus(); return; }
    if (window.Snd) { Snd.unlock(); Snd.play("join"); }
    location.href = "play.html?pin=" + pin;
  });

  /* ---------- รหัสผ่าน: กดเพื่อซ่อน/แสดง เพื่อตรวจสอบก่อนเข้าสู่ระบบ ---------- */
  const pwInput = $("#password");
  const pwToggle = $("#toggle-password");
  function paintPasswordToggle() {
    const shown = pwInput.type === "text";
    pwToggle.setAttribute("aria-pressed", shown ? "true" : "false");
    const label = shown ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน";
    pwToggle.setAttribute("aria-label", label);
    pwToggle.title = label;
    pwToggle.classList.toggle("on", shown);
    const eye = pwToggle.querySelector(".pw-icon-eye");
    const eyeOff = pwToggle.querySelector(".pw-icon-eye-off");
    if (eye) eye.classList.toggle("hidden", shown);
    if (eyeOff) eyeOff.classList.toggle("hidden", !shown);
  }
  function togglePassword() {
    const movingTo = pwInput.type === "password" ? "text" : "password";
    pwInput.type = movingTo;
    paintPasswordToggle();
    // ให้เคอร์เซอร์กลับไปอยู่ท้ายข้อความเสมอ
    const end = pwInput.value.length;
    try { pwInput.focus(); pwInput.setSelectionRange(end, end); } catch (e) { /* jsdom/เบราว์เซอร์เก่า */ }
  }
  pwToggle.addEventListener("click", togglePassword);
  paintPasswordToggle();

  /* ---------- ผู้จัด: หน้าต่างเข้าสู่ระบบ ---------- */
  const modal = $("#host-modal");
  const hostPanel = $("#host");
  let lastFocus = null;

  function modalOpen() { return !modal.classList.contains("hidden"); }

  function openHost() {
    if (modalOpen()) return;
    lastFocus = document.activeElement;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    try { history.replaceState(null, "", "#host"); } catch (e) { /* file:// บางเบราว์เซอร์ไม่ให้ */ }
    setTimeout(() => $("#email").focus(), 80);
  }
  function closeHost() {
    if (!modalOpen()) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* ไม่เป็นไร */ }
    if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === "function") lastFocus.focus();
    else $("#toggle-host").focus();
  }

  $("#toggle-host").addEventListener("click", openHost);
  $("#host-close").addEventListener("click", closeHost);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeHost(); });
  // กันไม่ให้การคลิกในฟอร์มทะลุไปถึงพื้นหลัง
  hostPanel.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("keydown", (e) => {
    if (!modalOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); closeHost(); return; }
    if (e.key !== "Tab") return;
    // โฟกัสวนอยู่ในหน้าต่างเท่านั้น
    const focusable = $$('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])', hostPanel);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // เข้าจาก host.html (ยังไม่ล็อกอิน) หรือเปิดลิงก์ index.html#host → เปิดหน้าต่างให้เลย
  if (location.hash === "#host") openHost();

  $$("#auth-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      authMode = b.dataset.mode;
      $$("#auth-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $("#auth-submit").textContent = authMode === "login" ? "เข้าสู่ระบบ →" : "สมัครและเริ่มใช้งาน →";
      pwInput.autocomplete = authMode === "login" ? "current-password" : "new-password";
    });
  });

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (loggedIn) { location.href = "admin.html"; return; }
    const btn = $("#auth-submit");
    const email = $("#email").value.trim();
    const password = pwInput.value;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "กำลังดำเนินการ…";
    try {
      if (authMode === "login") await API.signIn(email, password);
      else await API.signUp(email, password);
      if (window.Snd) { Snd.unlock(); Snd.play("start"); }
      location.href = "admin.html";
    } catch (err) {
      U.toast(err.message, "err", 4000);
      btn.disabled = false;
      btn.textContent = old;
    }
  });

  /* ถ้าเข้าสู่ระบบอยู่แล้ว แสดงทางลัด */
  API.currentUser().then((u) => {
    if (!u) return;
    loggedIn = true;
    const head = $("#host .card-head");
    if (head.querySelector(".pill")) head.querySelector(".pill").outerHTML = '<span class="pill pill-ok">เข้าสู่ระบบแล้ว</span>';
    $("#auth-submit").textContent = "ไปที่ห้องทำงาน →";
  }).catch(() => { });

  /* เปิดให้เครื่องมือทดสอบเรียกใช้ (ไม่กระทบผู้ใช้จริง) */
  window.__indexTest = { openHost, closeHost, isOpen: modalOpen };
})();
