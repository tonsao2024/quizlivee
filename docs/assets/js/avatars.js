/* ============================================================================
   ONLIVE QUIZ — ตัวละครผู้เล่น (Avatar system)
   ----------------------------------------------------------------------------
   ผู้เล่นตกแต่งตัวเองได้ระหว่างรอในห้องรอ:
     • สีผิว 6 แบบ
     • ตัวละคร 12 แบบ — คน (ชาย/หญิง/ครู/นักสืบ) + สัตว์น่ารัก (แมว หมา กระต่าย
       แพนด้า จิ้งจอก หมี กบ นกฮูก) + หุ่นยนต์
     • เครื่องแต่งกาย/ของประดับ 12 แบบ — มงกุฎ หมวกปาร์ตี้ หมวกแก๊ป หมวกนักสืบ
       แว่นกันแดด ผ้าพันคอ ป.ป.ช. หูกระต่าย ปลอกคอ ฯลฯ
     • สีเสื้อ 10 สี
   ---------------------------------------------------------------------------
   ใช้:
     Avatars.catalog()                       → { skins, chars, hats, shirts }
     Avatars.normalize(raw)                  → ข้อมูลที่ปลอดภัยต่อการวาด
     Avatars.svg(avatar, { cls, size })      → สตริง <svg>
     Avatars.picker(el, avatar, onChange)    → ตัวเลือกแบบสมบูรณ์ (การ์ด+แท็บ)
     Avatars.faces(avatar)                   → ชื่อสัตว์/ของประดับ (ไว้แสดงผล)
     Avatars.random()
   ข้อมูลที่เก็บ: { c:"cat", s:2, h:"crown", t:0 } (สั้น ๆ เพื่อประหยัดแถวฐานข้อมูล)
   ============================================================================ */
(function () {
  const SKINS = [
    { id: 0, name: "ผิวขาว", color: "#ffd9b8", shade: "#f0c19a" },
    { id: 1, name: "ผิวเนื้อ", color: "#f7c99b", shade: "#e0aa78" },
    { id: 2, name: "ผิวสองสี", color: "#e0a978", shade: "#c78b5b" },
    { id: 3, name: "ผิวแทน", color: "#c7804a", shade: "#a96635" },
    { id: 4, name: "ผิวเข้ม", color: "#8d5524", shade: "#6f3f18" },
    { id: 5, name: "ผิวน้ำตาลแดง", color: "#6b3f22", shade: "#523017" }
  ];

  const SHIRTS = [
    { id: 0, name: "ม่วง ป.ป.ช.", color: "#61116c" },
    { id: 1, name: "ทอง", color: "#ffdc01" },
    { id: 2, name: "แดง", color: "#e21b43" },
    { id: 3, name: "น้ำเงิน", color: "#1368ce" },
    { id: 4, name: "เขียว", color: "#0f7b3e" },
    { id: 5, name: "ส้ม", color: "#ffa602" },
    { id: 6, name: "ฟ้า", color: "#0aa3a3" },
    { id: 7, name: "ชมพู", color: "#ff5d8f" },
    { id: 8, name: "เทา", color: "#5a5a6b" },
    { id: 9, name: "ครีม", color: "#f4ead5" }
  ];

  const CHARS = [
    { id: "kid", name: "น้องหนู", emoji: "🧒", kind: "human" },
    { id: "girl", name: "น้องฟ้า", emoji: "👧", kind: "human" },
    { id: "boy", name: "น้องภูมิ", emoji: "👦", kind: "human" },
    { id: "teacher", name: "คุณครู", emoji: "🧑‍🏫", kind: "human" },
    { id: "detective", name: "นักสืบ", emoji: "🕵️", kind: "human" },
    { id: "cat", name: "แมวส้ม", emoji: "🐱", kind: "animal" },
    { id: "dog", name: "หมาน้อย", emoji: "🐶", kind: "animal" },
    { id: "rabbit", name: "กระต่าย", emoji: "🐰", kind: "animal" },
    { id: "panda", name: "แพนด้า", emoji: "🐼", kind: "animal" },
    { id: "fox", name: "จิ้งจอก", emoji: "🦊", kind: "animal" },
    { id: "bear", name: "หมีอุ่น", emoji: "🐻", kind: "animal" },
    { id: "frog", name: "กบเขียว", emoji: "🐸", kind: "animal" },
    { id: "owl", name: "นกฮูก", emoji: "🦉", kind: "animal" },
    { id: "robot", name: "หุ่นยนต์", emoji: "🤖", kind: "robot" }
  ];

  const HATS = [
    { id: "none", name: "ไม่ใส่", emoji: "🚫" },
    { id: "crown", name: "มงกุฎ", emoji: "👑" },
    { id: "party", name: "หมวกปาร์ตี้", emoji: "🎉" },
    { id: "cap", name: "หมวกแก๊ป", emoji: "🧢" },
    { id: "grad", name: "หมวกรับปริญญา", emoji: "🎓" },
    { id: "detective", name: "หมวกนักสืบ", emoji: "🎩" },
    { id: "glasses", name: "แว่นกันแดด", emoji: "🕶️" },
    { id: "bow", name: "โบว์", emoji: "🎀" },
    { id: "flower", name: "ดอกไม้", emoji: "🌺" },
    { id: "headset", name: "หูฟัง", emoji: "🎧" },
    { id: "halo", name: "วงแหวนเทวทูต", emoji: "😇" },
    { id: "nacc", name: "เข็ม ป.ป.ช.", emoji: "🛡️" }
  ];

  const map = (arr) => { const m = {}; arr.forEach((x) => (m[x.id] = x)); return m; };
  const CHAR_BY = map(CHARS), HAT_BY = map(HATS), SKIN_BY = map(SKINS), SHIRT_BY = map(SHIRTS);
  const charIds = CHARS.map((c) => c.id);
  const hatIds = HATS.map((h) => h.id);

  function hash(str) {
    let h = 2166136261;
    const s = String(str || "?");
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }

  /* สร้างตัวละครเริ่มต้นจากชื่อ (คงที่ต่อคน) */
  function fromName(name) {
    const h = hash(name);
    return {
      c: charIds[h % charIds.length],
      s: (h >> 3) % SKINS.length,
      h: h % 5 === 0 ? hatIds[(h >> 5) % hatIds.length] : "none",
      t: (h >> 7) % SHIRTS.length
    };
  }

  function normalize(raw) {
    let a = raw;
    if (typeof a === "string") { try { a = JSON.parse(a); } catch (e) { a = null; } }
    if (!a || typeof a !== "object") return { c: "kid", s: 0, h: "none", t: 0 };
    const c = CHAR_BY[a.c] ? a.c : "kid";
    const s = Math.max(0, Math.min(SKINS.length - 1, Number(a.s) || 0));
    const hh = HAT_BY[a.h] ? a.h : "none";
    const t = Math.max(0, Math.min(SHIRTS.length - 1, Number(a.t) || 0));
    return { c, s, h: hh, t };
  }

  function label(a) {
    a = normalize(a);
    return (CHAR_BY[a.c] || {}).name || "ตัวละคร";
  }

  /* ------------------------------------------------------------ วาด SVG --- */
  const E = (s) => String(s == null ? "" : s);
  const eyes = (x1, x2, y, r) =>
    '<circle cx="' + x1 + '" cy="' + y + '" r="' + r + '" fill="#fff"/>' +
    '<circle cx="' + x2 + '" cy="' + y + '" r="' + r + '" fill="#fff"/>' +
    '<circle cx="' + (x1 + 0.7) + '" cy="' + (y + 1) + '" r="' + r * 0.48 + '" fill="#20202a"/>' +
    '<circle cx="' + (x2 + 0.7) + '" cy="' + (y + 1) + '" r="' + r * 0.48 + '" fill="#20202a"/>' +
    '<circle cx="' + (x1 - r * 0.28) + '" cy="' + (y - r * 0.35) + '" r="' + r * 0.2 + '" fill="#fff"/>' +
    '<circle cx="' + (x2 - r * 0.28) + '" cy="' + (y - r * 0.35) + '" r="' + r * 0.2 + '" fill="#fff"/>';

  const smile = (y, w) => '<path d="M' + (60 - w / 2) + ' ' + y + 'q' + (w / 2) + ' 9 ' + w + ' 0" stroke="#20202a" stroke-width="3" fill="none" stroke-linecap="round"/>';
  const blush = (y) => '<circle cx="43" cy="' + y + '" r="4.6" fill="#ff8fa3" opacity=".55"/><circle cx="77" cy="' + y + '" r="4.6" fill="#ff8fa3" opacity=".55"/>';

  function body(shirt, skin) {
    return '<ellipse cx="60" cy="126" rx="34" ry="6" fill="rgba(0,0,0,.22)"/>' +
      '<path d="M22 126c0-34 6-56 16-66 6-6 14-9 22-9s16 3 22 9c10 10 16 32 16 66z" fill="' + shirt + '"/>' +
      '<path d="M22 126c0-34 6-56 16-66 5-5 11-8 18-9v75z" fill="rgba(0,0,0,.10)"/>' +
      '<circle cx="33" cy="100" r="9" fill="' + (skin || shirt) + '"/>' +
      '<circle cx="87" cy="100" r="9" fill="' + (skin || shirt) + '"/>';
  }
  const collar = () => '<path d="M49 63h22l-11 14z" fill="rgba(255,255,255,.42)"/>';

  /* ทรงผม: front = ทับบนหัว, back = อยู่หลังหัว (ผมยาว/หางม้า) */
  function hair(type) {
    const C = { kid: "#3a2a1e", girl: "#4a2c1b", boy: "#1f1a17", teacher: "#2b2b3a", detective: "#241d1a" };
    const col = C[type] || "#2b2b3a";
    const cap = '<path d="M31 46C31 24 44 13 60 13s29 11 29 33c0 3-3 4-5 1-4-6-7-10-11-10-2 5-7 8-13 8s-11-3-13-8c-4 0-7 4-11 10-2 3-5 2-5-1z" fill="' + col + '"/>';
    if (type === "long" || type === "pigtail") {
      const back = '<path d="M29 46c0-20 14-32 31-32s31 12 31 32v44c0 6-7 8-11 3V56H40v37c-4 5-11 3-11-3z" fill="' + col + '"/>' +
        (type === "pigtail" ? '<circle cx="24" cy="62" r="10" fill="' + col + '"/><circle cx="96" cy="62" r="10" fill="' + col + '"/>' : "");
      return { back, front: cap };
    }
    if (type === "bun") {
      return { back: '<circle cx="60" cy="13" r="10" fill="' + col + '"/>', front: cap };
    }
    if (type === "curly") {
      return {
        back: "", front: cap +
          '<g fill="' + col + '"><circle cx="40" cy="26" r="10"/><circle cx="60" cy="17" r="11"/><circle cx="80" cy="26" r="10"/><circle cx="32" cy="40" r="7"/><circle cx="88" cy="40" r="7"/></g>'
      };
    }
    if (type === "spiky") {
      return {
        back: "", front: '<path d="M31 46C31 24 44 13 60 13s29 11 29 33c-3-6-6-9-9-10-2 6-6 8-10 8 1-6-3-10-6-12-2 8-7 10-11 10-3-6-7-8-11-6-3 1-6 4-7 10-2 1-4-1-4-2z" fill="' + col + '"/>'
      };
    }
    if (type === "tuft") {
      return {
        back: "", front: cap +
          '<path d="M58 16c3-9 10-11 15-7-5 1-8 4-9 9z" fill="' + col + '"/>'
      };
    }
    return { back: "", front: cap };  // short
  }

  function humanHead(skinColor, shade, opts) {
    const o = opts || {};
    const h = hair(o.hair || "short");
    return '<ellipse cx="60" cy="123" rx="33" ry="6" fill="rgba(0,0,0,.22)"/>' +
      body(o.shirt || "#61116c", skinColor) +
      h.back +
      '<circle cx="60" cy="48" r="27" fill="' + skinColor + '"/>' +
      '<ellipse cx="33.5" cy="52" rx="4.8" ry="6.2" fill="' + skinColor + '"/>' +
      '<ellipse cx="86.5" cy="52" rx="4.8" ry="6.2" fill="' + skinColor + '"/>' +
      '<path d="M60 75a27 27 0 0 0 27-21c-9 7-45 9-54 0a27 27 0 0 0 27 21z" fill="' + (shade || skinColor) + '" opacity=".22"/>' +
      h.front +
      eyes(51, 69, 50, 5.8) +
      '<path d="M60 55q-3 5 0 7" stroke="' + (shade || skinColor) + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
      smile(63, 13) + blush(59) +
      (o.glasses ? '<g fill="none" stroke="#20202a" stroke-width="2.6"><circle cx="51" cy="50" r="9.6"/><circle cx="69" cy="50" r="9.6"/><path d="M60.6 50h-1"/></g>' : "");
  }

  const FUR = {
    cat: "#f0a04b", dog: "#b9793f", rabbit: "#f3e4d1", panda: "#f7f2ea",
    fox: "#e8772e", bear: "#a9713f", frog: "#74c96b", owl: "#b98a5c"
  };
  function hex2rgb(h) {
    h = String(h || "#888").replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  }
  function mix(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
  }
  const darken = (c, f) => mix(c, "#000000", f == null ? 0.22 : f);

  function animalHead(kind, skinColor, shade, shirt) {
    // สีขน = สีธรรมชาติของสัตว์ ผสมกับสีผิวที่ผู้เล่นเลือกเล็กน้อย
    const natural = FUR[kind] || "#d9a066";
    const lightKinds = { panda: 0.08, rabbit: 0.12, owl: 0.18 };
    const base = mix(natural, skinColor, lightKinds[kind] == null ? 0.3 : lightKinds[kind]);
    const dark = darken(base, 0.26);
    const out = [];
    out.push('<ellipse cx="60" cy="124" rx="33" ry="6" fill="rgba(0,0,0,.22)"/>');
    out.push(body(shirt || "#61116c", base));
    // หู
    if (kind === "cat" || kind === "fox") {
      out.push('<path d="M34 34l4-22 20 12z" fill="' + base + '"/><path d="M86 34l-4-22-20 12z" fill="' + base + '"/>');
      out.push('<path d="M39 30l2-11 10 6z" fill="#ffb3c6"/><path d="M81 30l-2-11-10 6z" fill="#ffb3c6"/>');
    } else if (kind === "rabbit") {
      out.push('<ellipse cx="46" cy="16" rx="8" ry="20" fill="' + base + '"/><ellipse cx="74" cy="16" rx="8" ry="20" fill="' + base + '"/>');
      out.push('<ellipse cx="46" cy="17" rx="4" ry="14" fill="#ffb3c6"/><ellipse cx="74" cy="17" rx="4" ry="14" fill="#ffb3c6"/>');
    } else if (kind === "bear" || kind === "panda") {
      out.push('<circle cx="38" cy="28" r="12" fill="' + base + '"/><circle cx="82" cy="28" r="12" fill="' + base + '"/>');
      out.push('<circle cx="38" cy="28" r="6" fill="' + dark + '"/><circle cx="82" cy="28" r="6" fill="' + dark + '"/>');
    } else if (kind === "dog") {
      out.push('<path d="M30 30c-8 6-8 22 2 26 6 3 12-4 12-12z" fill="' + dark + '"/><path d="M90 30c8 6 8 22-2 26-6 3-12-4-12-12z" fill="' + dark + '"/>');
    } else if (kind === "owl") {
      out.push('<path d="M32 30l6-16 12 12z" fill="' + dark + '"/><path d="M88 30l-6-16-12 12z" fill="' + dark + '"/>');
    } else if (kind === "frog") {
      out.push('<circle cx="44" cy="24" r="12" fill="' + base + '"/><circle cx="76" cy="24" r="12" fill="' + base + '"/>');
    }
    out.push('<circle cx="60" cy="48" r="28" fill="' + base + '"/>');
    if (kind === "panda") {
      out.push('<ellipse cx="50" cy="44" rx="9" ry="11" fill="#20202a" transform="rotate(-12 50 44)"/><ellipse cx="70" cy="44" rx="9" ry="11" fill="#20202a" transform="rotate(12 70 44)"/>');
      out.push('<circle cx="50" cy="44" r="4.4" fill="#fff"/><circle cx="70" cy="44" r="4.4" fill="#fff"/><circle cx="50.6" cy="44.6" r="2.2" fill="#20202a"/><circle cx="70.6" cy="44.6" r="2.2" fill="#20202a"/>');
    } else if (kind === "frog") {
      out.push(eyes(44, 76, 26, 8.4));
      out.push(smile(56, 18));
    } else {
      out.push(eyes(50.5, 69.5, 45, 5.6));
    }
    // จมูก/ปาก
    if (kind === "cat" || kind === "dog" || kind === "fox") {
      out.push('<path d="M54 54h12l-6 6z" fill="#ff8fa3"/>');
      out.push('<path d="M60 60v4" stroke="#20202a" stroke-width="2.2" stroke-linecap="round"/>');
      out.push('<path d="M52 64q8 7 16 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/>');
      if (kind === "cat" || kind === "fox") {
        out.push('<g stroke="' + dark + '" stroke-width="1.8" stroke-linecap="round"><path d="M40 52h-12M40 57h-12M80 52h12M80 57h12"/></g>');
      }
      if (kind === "fox") {
        out.push('<path d="M40 66q20 14 40 0" stroke="#f6e7d5" stroke-width="0" fill="none"/>');
      }
    } else if (kind === "bear" || kind === "panda") {
      out.push('<ellipse cx="60" cy="57" rx="7" ry="5" fill="#20202a" opacity=".7"/>');
      out.push(smile(64, 14));
    } else if (kind === "rabbit") {
      out.push('<path d="M54 55h12l-6 6z" fill="#ff8fa3"/>');
      out.push('<path d="M60 61v3M52 65q8 6 16 0" stroke="#20202a" stroke-width="2.2" fill="none" stroke-linecap="round"/>');
    } else if (kind === "owl") {
      out.push('<path d="M55 52l10 0-5 8z" fill="#ffb703"/>');
    }
    out.push(blush(56));
    return out.join("");
  }

  function robotHead(skinColor, shirt) {
    return '<ellipse cx="60" cy="124" rx="32" ry="6" fill="rgba(0,0,0,.22)"/>' +
      '<rect x="22" y="66" width="76" height="58" rx="16" fill="' + shirt + '"/>' +
      '<rect x="45" y="76" width="30" height="20" rx="5" fill="rgba(255,255,255,.22)"/>' +
      '<rect x="30" y="24" width="60" height="48" rx="16" fill="' + (skinColor || "#cfd8e3") + '"/>' +
      '<rect x="36" y="32" width="48" height="30" rx="10" fill="#20202a"/>' +
      '<circle cx="50" cy="47" r="6" fill="#5fe0d4"/><circle cx="70" cy="47" r="6" fill="#5fe0d4"/>' +
      '<circle cx="60" cy="16" r="5" fill="#ff8fa3"/>' +
      '<path d="M60 21v3" stroke="' + (skinColor || "#cfd8e3") + '" stroke-width="3"/>' +
      '<rect x="52" y="68" width="16" height="5" rx="2.5" fill="#ffdc01"/>' +
      '<g stroke="' + (skinColor || "#cfd8e3") + '" stroke-width="4" stroke-linecap="round"><path d="M20 82v16M100 82v16"/></g>';
  }

  function hatMarkup(id, kind) {
    switch (id) {
      case "crown":
        return '<g class="av-hat av-crown"><path d="M30 24h60l-7-30-16 13L60 -9 43 7 37 -6z" fill="#ffd23f" stroke="#b87800" stroke-width="3.4" stroke-linejoin="round"/>' +
          '<circle cx="60" cy="8" r="4" fill="#ff4d7d"/><circle cx="43" cy="6" r="3" fill="#5fe0d4"/><circle cx="77" cy="6" r="3" fill="#5fe0d4"/></g>';
      case "party":
        return '<g class="av-hat"><path d="M60 -26l18 46H42z" fill="#ff5d8f"/><path d="M46 12h28l-3 7H49z" fill="#ffdc01"/><circle cx="60" cy="-28" r="5.5" fill="#5fe0d4"/></g>';
      case "cap":
        return '<g class="av-hat"><path d="M32 26c0-16 12-26 28-26s28 10 28 26z" fill="#1368ce"/><path d="M60 8h30c4 0 6 3 6 6v6H60z" fill="#0d4fa0"/><circle cx="60" cy="6" r="3" fill="#ffdc01"/></g>';
      case "grad":
        return '<g class="av-hat"><path d="M60 2L20 16l40 14 40-14z" fill="#20202a"/><path d="M42 24v12c0 5 8 8 18 8s18-3 18-8V24l-18 6z" fill="#2f2f3d"/><path d="M96 18v20" stroke="#ffdc01" stroke-width="3"/><circle cx="96" cy="40" r="4" fill="#ffdc01"/></g>';
      case "detective":
        return '<g class="av-hat"><ellipse cx="60" cy="22" rx="36" ry="7" fill="#3b2b22"/><path d="M38 22c0-14 8-22 22-22s22 8 22 22z" fill="#5a4232"/><path d="M40 20h40v6H40z" fill="#20202a" opacity=".5"/></g>';
      case "glasses":
        return '<g class="av-hat"><rect x="34" y="38" width="52" height="16" rx="8" fill="#20202a" opacity=".85"/><rect x="38" y="41" width="20" height="10" rx="5" fill="#5fe0d4" opacity=".55"/><rect x="62" y="41" width="20" height="10" rx="5" fill="#5fe0d4" opacity=".55"/></g>';
      case "bow":
        return '<g class="av-hat"><path d="M60 14l-16-9v18z" fill="#ff5d8f"/><path d="M60 14l16-9v18z" fill="#ff5d8f"/><circle cx="60" cy="14" r="4.5" fill="#ffb3c6"/></g>';
      case "flower":
        return '<g class="av-hat"><circle cx="82" cy="26" r="6" fill="#ff5d8f"/><circle cx="74" cy="20" r="6" fill="#ff8fb1"/><circle cx="76" cy="30" r="6" fill="#ffb3c6"/><circle cx="78" cy="25" r="3.4" fill="#ffdc01"/></g>';
      case "headset":
        return '<g class="av-hat"><path d="M28 46v-6a32 32 0 0 1 64 0v6" fill="none" stroke="#20202a" stroke-width="5"/><rect x="18" y="42" width="14" height="22" rx="7" fill="#ff5d8f"/><rect x="88" y="42" width="14" height="22" rx="7" fill="#ff5d8f"/></g>';
      case "halo":
        return '<g class="av-hat av-halo"><ellipse cx="60" cy="-2" rx="21" ry="6.4" fill="none" stroke="#ffdc01" stroke-width="4.4"/></g>';
      case "nacc":
        return '<g class="av-hat"><circle cx="60" cy="120" r="0" fill="none"/><path d="M46 88l14-8 14 8v10c0 7-6 12-14 14-8-2-14-7-14-14z" fill="#ffdc01" stroke="#b87800" stroke-width="2.4"/><path d="M53 96l5 5 10-11" stroke="#61116c" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>';
      default:
        return "";
    }
  }

  /* สร้าง SVG ตัวละคร (viewBox 0 0 120 132) */
  function svg(raw, opts) {
    const a = normalize(raw);
    const o = opts || {};
    const skin = SKIN_BY[a.s] || SKINS[0];
    const shirt = (SHIRT_BY[a.t] || SHIRTS[0]).color;
    const isHuman = ["kid", "girl", "boy", "teacher", "detective"].indexOf(a.c) >= 0;
    const isRobot = a.c === "robot";
    let inner = "";
    let topOffset = 0;

    if (isRobot) {
      inner = robotHead(skin.color, shirt);
      topOffset = 6;
    } else if (isHuman) {
      const o2 = { shirt, hair: "short", glasses: false, beard: false };
      if (a.c === "kid") { o2.hair = "tuft"; }
      else if (a.c === "girl") { o2.hair = "pigtail"; }
      else if (a.c === "boy") { o2.hair = "spiky"; }
      else if (a.c === "teacher") { o2.hair = "bun"; o2.glasses = true; }
      else if (a.c === "detective") { o2.hair = "curly"; o2.glasses = true; }
      inner = humanHead(skin.color, skin.shade, o2);
      topOffset = 4;
    } else {
      inner = animalHead(a.c, skin.color, skin.shade, shirt) + collar(shirt);
      topOffset = 4;
    }
    if (isHuman) inner += collar(shirt);

    const cls = "avatar-svg " + E(o.cls || "");
    const style = o.size ? ' style="width:' + o.size + 'px;height:auto"' : "";
    return '<svg class="' + cls + '" viewBox="0 -36 120 172" aria-hidden="true"' + style + ">" +
      '<g>' + inner + "</g>" +
      '<g transform="translate(0 ' + (topOffset - 4) + ')">' + hatMarkup(a.h, a.c) + "</g>" +
      "</svg>";
  }

  /* --------------------------------------------------------- ตัวเลือก UI --- */
  const TABS = [
    { id: "char", label: "ตัวละคร" },
    { id: "skin", label: "สีผิว" },
    { id: "hat", label: "เครื่องแต่งกาย" },
    { id: "shirt", label: "สีเสื้อ" }
  ];

  function picker(el, initial, onChange) {
    if (!el) return null;
    let a = normalize(initial);
    let tab = "char";
    const emit = () => { try { onChange && onChange({ c: a.c, s: a.s, h: a.h, t: a.t }); } catch (e) { } };
    const heroName = () => ((CHAR_BY[a.c] || {}).name || "") + (a.h !== "none" ? " · " + ((HAT_BY[a.h] || {}).name || "") : "");

    /* โครงหน้าจอสร้าง "ครั้งเดียว" — หลังจากนั้นอัปเดตเฉพาะจุดที่เปลี่ยน
       (เดิมสร้าง HTML ใหม่ทั้งก้อนทุกครั้งที่กดเลือก ทำให้รายการเลื่อนกลับขึ้นบน
        และทั้งหน้ากระพริบ/เด้ง) */
    el.innerHTML =
      '<div class="av-wrap">' +
      '<div class="av-stage"><div class="av-hero" id="av-hero"></div>' +
      '<div class="av-hero-name"></div>' +
      '<button class="btn btn-sm btn-ghost" id="av-random" type="button">🎲 สุ่มให้หน่อย</button>' +
      "</div>" +
      '<div class="av-tabs tabs">' + TABS.map((t) =>
        '<button type="button" data-avtab="' + t.id + '">' + t.label + "</button>").join("") + "</div>" +
      '<div class="av-body" id="av-body"></div>' +
      "</div>";
    const hero = el.querySelector("#av-hero");
    const nameEl = el.querySelector(".av-hero-name");
    const body = el.querySelector("#av-body");

    function paintHero(pop) {
      hero.innerHTML = svg(a);
      nameEl.textContent = heroName();
      if (pop) {
        hero.classList.remove("pop");
        void hero.offsetWidth;
        hero.classList.add("pop");
      }
    }

    function paintBody() {
      el.querySelectorAll("[data-avtab]").forEach((b) => b.classList.toggle("on", b.dataset.avtab === tab));
      if (tab === "char") {
        body.innerHTML = '<div class="av-grid av-chars">' + CHARS.map((c) =>
          '<button type="button" class="av-chip" data-c="' + c.id + '">' +
          '<span class="av-chip-face">' + svg({ c: c.id, s: a.s, h: "none", t: a.t }) + "</span>" +
          '<span class="av-chip-nm">' + c.emoji + " " + c.name + "</span></button>").join("") + "</div>";
      } else if (tab === "skin") {
        body.innerHTML = '<div class="av-grid av-skins">' + SKINS.map((s) =>
          '<button type="button" class="av-swatch" data-s="' + s.id + '" title="' + s.name + '">' +
          '<span style="background:' + s.color + '"></span><i>' + s.name + "</i></button>").join("") + "</div>";
      } else if (tab === "hat") {
        body.innerHTML = '<div class="av-grid av-hats">' + HATS.map((h) =>
          '<button type="button" class="av-chip" data-h="' + h.id + '">' +
          '<span class="av-chip-face">' + svg({ c: a.c, s: a.s, h: h.id, t: a.t }) + "</span>" +
          '<span class="av-chip-nm">' + h.emoji + " " + h.name + "</span></button>").join("") + "</div>";
      } else {
        body.innerHTML = '<div class="av-grid av-shirts">' + SHIRTS.map((t) =>
          '<button type="button" class="av-swatch" data-t="' + t.id + '" title="' + t.name + '">' +
          '<span style="background:' + t.color + '"></span><i>' + t.name + "</i></button>").join("") + "</div>";
      }
      body.scrollTop = 0;
      markSelected();
    }

    /* ไฮไลต์ตัวที่เลือกอยู่ โดยไม่แตะโครง DOM (ตำแหน่งเลื่อนจึงไม่ขยับ) */
    function markSelected() {
      ["c", "s", "h", "t"].forEach((k) => {
        body.querySelectorAll("[data-" + k + "]").forEach((b) => {
          b.classList.toggle("on", String(a[k]) === b.dataset[k]);
        });
      });
    }

    function select(k, v) {
      const val = (k === "s" || k === "t") ? +v : v;
      if (a[k] === val) return;                  // กดซ้ำตัวเดิม ไม่ต้องทำอะไร
      a[k] = val;
      markSelected();
      paintHero(true);
      emit();
      if (window.Snd) { try { Snd.play("click"); } catch (e) { } }
    }

    // ผูกเหตุการณ์ครั้งเดียวที่กล่องแม่ (event delegation)
    body.addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest("[data-c],[data-s],[data-h],[data-t]") : null;
      if (!b || !body.contains(b)) return;
      const k = ["c", "s", "h", "t"].find((x) => b.dataset[x] != null);
      if (k) select(k, b.dataset[k]);
    });
    el.querySelectorAll("[data-avtab]").forEach((b) =>
      b.addEventListener("click", () => {
        if (tab === b.dataset.avtab) return;
        tab = b.dataset.avtab; paintBody();
      }));
    el.querySelector("#av-random").addEventListener("click", () => {
      a = normalize(random());
      paintBody(); paintHero(true); emit();
      if (window.Snd) { try { Snd.play("click"); } catch (e) { } }
    });

    paintHero(false);
    paintBody();
    return {
      get: () => ({ c: a.c, s: a.s, h: a.h, t: a.t }),
      set: (v) => {
        const n = normalize(v);
        if (n.c === a.c && n.s === a.s && n.h === a.h && n.t === a.t) return;   // เหมือนเดิม ไม่ต้องวาดใหม่
        a = n; paintHero(false); paintBody();
      }
    };
  }

  function random() {
    const h = Math.floor(Math.random() * 1e9);
    return {
      c: charIds[h % charIds.length],
      s: h % SKINS.length,
      h: Math.random() < 0.55 ? "none" : hatIds[h % hatIds.length],
      t: (h >> 3) % SHIRTS.length
    };
  }

  window.Avatars = {
    catalog: () => ({ skins: SKINS, chars: CHARS, hats: HATS, shirts: SHIRTS }),
    normalize, fromName, svg, picker, random,
    label, name: label
  };
})();
