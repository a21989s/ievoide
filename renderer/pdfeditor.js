import * as pdfjsLib from "../node_modules/pdfjs-dist/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const $ = (id) => document.getElementById(id);
const editorEl = $("pdfeditor");
const pagesEl = $("pePages");

let state = null; // { bytes, name, path, pages:[], tool, color }

// ── 打开 ───────────────────────────────────────────────────
window.openPdfEditor = async function (path, name) {
  const r = await window.api.readFileBuffer(path);
  if (!r || r.error) {
    alert(tr("读取 PDF 失败：") + (r?.error || tr("未知")));
    return;
  }
  const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
  state = { bytes, name, path, pages: [], tool: "select", color: "#ff3b30" };
  const myState = state; // 渲染期间用于检测 state 是否被关闭/切换
  editorEl.style.display = "flex";
  pagesEl.innerHTML = "";
  setStatus(tr("渲染中…"));

  // pdf.js 需要独立副本（它会 transfer/detach buffer）
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  if (state !== myState) return; // 已关闭或切换到别的 PDF
  const containerW = pagesEl.clientWidth - 40;
  for (let i = 1; i <= doc.numPages; i++) {
    if (state !== myState) return; // 大 PDF 渲染中途被关闭/切换，立即中止循环
    const page = await doc.getPage(i);
    if (state !== myState) return;
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(containerW / unscaled.width, 1.6);
    const viewport = page.getViewport({ scale });
    await renderPage(page, viewport, scale, i, myState);
  }
  if (state !== myState) return;
  setStatus(trf("{0} 页", doc.numPages));
  setTool("select");
};

async function renderPage(page, viewport, scale, pageNum, owner) {
  const wrap = document.createElement("div");
  wrap.className = "pe-page";
  wrap.style.width = viewport.width + "px";
  wrap.style.height = viewport.height + "px";

  const badge = document.createElement("div");
  badge.className = "pe-pagebadge";
  badge.textContent = trf("第 {0} 页", pageNum);
  wrap.appendChild(badge);

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  wrap.appendChild(canvas);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  if (!state || state !== owner) return; // 渲染期间被关闭/切换，勿再访问 state.pages

  const layer = document.createElement("div");
  layer.className = "pe-layer";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
  layer.appendChild(svg);
  wrap.appendChild(layer);

  pagesEl.appendChild(wrap);

  const pst = {
    pageNum,
    scale,
    widthPt: viewport.width / scale,
    heightPt: viewport.height / scale,
    rotation: 0,
    deleted: false,
    annots: [], // {type, ...} draw/highlight 固定几何；text/whiteout 持 element
    wrap,
    layer,
    svg,
  };
  state.pages.push(pst);
  attachTools(pst);
}

// ── 工具栏 ─────────────────────────────────────────────────
function setStatus(t) {
  $("peStatus").textContent = t;
}
function setTool(tool) {
  state.tool = tool;
  document
    .querySelectorAll(".pe-toolbar [data-tool]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  // 选择模式下文字框可编辑/拖动；其它模式由 layer 捕获绘制
  for (const p of state.pages) {
    p.layer.style.cursor =
      tool === "draw" || tool === "highlight"
        ? "crosshair"
        : tool === "text" || tool === "whiteout"
        ? "copy"
        : "default";
  }
}

document.querySelectorAll(".pe-toolbar [data-tool]").forEach((b) => {
  b.onclick = () => setTool(b.dataset.tool);
});
$("peColor").onchange = (e) => (state.color = e.target.value);
$("peClose").onclick = () => {
  editorEl.style.display = "none";
  state = null;
};

// ── 每页的指针交互 ─────────────────────────────────────────
function attachTools(p) {
  const layer = p.layer;
  let drag = null;

  layer.addEventListener("pointerdown", (e) => {
    if (!state) return;
    const tool = state.tool;
    const { x, y } = local(layer, e);

    if (tool === "text") {
      addTextBox(p, x, y, false);
      return;
    }
    if (tool === "draw") {
      const poly = svgEl("polyline", {
        fill: "none",
        stroke: state.color,
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      p.svg.appendChild(poly);
      drag = { kind: "draw", points: [[x, y]], poly };
      layer.setPointerCapture(e.pointerId);
    } else if (tool === "highlight" || tool === "whiteout") {
      const rect = svgEl("rect", {
        x,
        y,
        width: 0,
        height: 0,
        fill: tool === "highlight" ? state.color : "#ffffff",
        "fill-opacity": tool === "highlight" ? 0.35 : 1,
        stroke: tool === "whiteout" ? "#c33" : "none",
        "stroke-dasharray": "3 2",
      });
      p.svg.appendChild(rect);
      drag = { kind: tool, x0: x, y0: y, rect };
      layer.setPointerCapture(e.pointerId);
    }
  });

  layer.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const { x, y } = local(layer, e);
    if (drag.kind === "draw") {
      drag.points.push([x, y]);
      drag.poly.setAttribute("points", drag.points.map((q) => q.join(",")).join(" "));
    } else {
      const nx = Math.min(drag.x0, x),
        ny = Math.min(drag.y0, y);
      const w = Math.abs(x - drag.x0),
        h = Math.abs(y - drag.y0);
      attr(drag.rect, { x: nx, y: ny, width: w, height: h });
    }
  });

  layer.addEventListener("pointerup", (e) => {
    if (!drag) return;
    if (drag.kind === "draw") {
      p.annots.push({ type: "draw", color: state.color, width: 2, points: drag.points });
    } else if (drag.kind === "highlight") {
      const b = rectBox(drag.rect);
      if (b.w > 3 && b.h > 3)
        p.annots.push({ type: "highlight", color: state.color, ...b });
      else drag.rect.remove();
    } else if (drag.kind === "whiteout") {
      const b = rectBox(drag.rect);
      if (b.w > 5 && b.h > 5) addTextBox(p, b.x, b.y, true, b.w, b.h);
      drag.rect.remove(); // 用 DOM 白框替代，便于输入替换文字
    }
    drag = null;
  });
}

// 文字框 / 遮盖框（可编辑 DOM）
function addTextBox(p, x, y, whiteout, w, h) {
  const box = document.createElement("div");
  box.className = "pe-tbox" + (whiteout ? " whiteout" : "");
  box.contentEditable = "true";
  box.style.left = x + "px";
  box.style.top = y + "px";
  box.style.color = whiteout ? "#000" : state.color;
  box.style.fontSize = "16px";
  if (whiteout) {
    box.style.width = w + "px";
    box.style.minHeight = h + "px";
  }
  const del = document.createElement("span");
  del.className = "del";
  del.textContent = "×";
  del.contentEditable = "false";
  del.onclick = (ev) => {
    ev.stopPropagation();
    box.remove();
    p.annots = p.annots.filter((a) => a.el !== box);
  };
  box.appendChild(del);
  p.layer.appendChild(box);

  const annot = { type: whiteout ? "whiteout" : "text", el: box, whiteout };
  p.annots.push(annot);
  // 拖动（选择模式按住边缘移动）
  enableDrag(box, p);
  setTimeout(() => box.focus(), 0);
}

function enableDrag(box, p) {
  let move = null;
  box.addEventListener("pointerdown", (e) => {
    if (!state) return;
    if (state.tool !== "select" || e.target.classList.contains("del")) return;
    if (e.altKey === false && document.activeElement === box) return; // 编辑中不拖
    const { x, y } = local(p.layer, e);
    move = {
      ox: x,
      oy: y,
      left: parseFloat(box.style.left) || 0,
      top: parseFloat(box.style.top) || 0,
    };
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener("pointermove", (e) => {
    if (!move) return;
    const { x, y } = local(p.layer, e);
    box.style.left = move.left + (x - move.ox) + "px";
    box.style.top = move.top + (y - move.oy) + "px";
  });
  box.addEventListener("pointerup", (e) => {
    if (!move) return;
    box.releasePointerCapture(e.pointerId);
    move = null; // 坐标已写入 box.style，保存时直接读取
  });
}

// ── 页面操作 ───────────────────────────────────────────────
function visiblePageAtCenter() {
  if (!state) return null;
  // 取当前滚动视口中心所在的页
  const mid = pagesEl.scrollTop + pagesEl.clientHeight / 2;
  let best = null,
    bestD = Infinity;
  for (const p of state.pages) {
    if (p.deleted) continue;
    const top = p.wrap.offsetTop,
      bot = top + p.wrap.offsetHeight;
    const d = Math.abs((top + bot) / 2 - mid);
    if (d < bestD) (bestD = d), (best = p);
  }
  return best;
}
$("peRotate").onclick = () => {
  const p = visiblePageAtCenter();
  if (!p) return;
  p.rotation = (p.rotation + 90) % 360;
  // 仅视觉提示旋转（保存时写入 PDF 旋转标记）
  p.wrap.style.transform = `rotate(${p.rotation}deg)`;
  setStatus(trf("第 {0} 页将旋转 {1}°（保存生效）", p.pageNum, p.rotation));
};
$("peDelete").onclick = () => {
  const p = visiblePageAtCenter();
  if (!p) return;
  p.deleted = true;
  p.wrap.classList.add("deleted");
  setStatus(trf("第 {0} 页将删除（保存生效）", p.pageNum));
};

// ── 表单填写 ───────────────────────────────────────────────
$("peForm").onclick = async () => {
  const panel = $("peForms");
  const fieldsEl = $("peFormFields");
  fieldsEl.innerHTML = "";
  try {
    const doc = await PDFLib.PDFDocument.load(state.bytes.slice());
    const fields = doc.getForm().getFields();
    if (!fields.length) {
      fieldsEl.innerHTML = `<div style='color:#888;font-size:12px'>${tr("该 PDF 无表单字段")}</div>`;
    } else {
      for (const f of fields) {
        const name = f.getName();
        const label = document.createElement("label");
        label.textContent = name;
        const input = document.createElement("input");
        input.dataset.field = name;
        try {
          if (f.constructor.name.includes("TextField")) input.value = f.getText() || "";
        } catch {}
        fieldsEl.appendChild(label);
        fieldsEl.appendChild(input);
      }
    }
    panel.style.display = "block";
  } catch (err) {
    alert(tr("读取表单失败：") + err);
  }
};
$("peFormApply").onclick = () => {
  // 收集值，存到 state 供保存时应用
  state.formValues = {};
  $("peFormFields")
    .querySelectorAll("input[data-field]")
    .forEach((i) => (state.formValues[i.dataset.field] = i.value));
  $("peForms").style.display = "none";
  setStatus(tr("表单值已记录，保存时写入"));
};

// ── 保存：用 pdf-lib 应用全部修改 ──────────────────────────
$("peSave").onclick = async () => {
  if (!state) return;
  setStatus(tr("保存中…"));
  try {
    const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
    const doc = await PDFDocument.load(state.bytes.slice());
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let cjkWarn = false;

    // 表单值
    if (state.formValues) {
      const form = doc.getForm();
      for (const [k, v] of Object.entries(state.formValues)) {
        try {
          form.getTextField(k).setText(v);
        } catch {}
      }
    }

    const libPages = doc.getPages();
    for (const p of state.pages) {
      if (p.deleted) continue;
      const page = libPages[p.pageNum - 1];
      if (!page) continue;
      const H = p.heightPt;
      const col = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
      };
      const drawText = (el, x, y, color) => {
        const txt = (el.innerText || "").replace(/​/g, "").trim();
        if (!txt) return;
        const sizePt = 16 / p.scale;
        try {
          page.drawText(txt, {
            x: x / p.scale,
            y: H - y / p.scale - sizePt,
            size: sizePt,
            font,
            color,
          });
        } catch {
          cjkWarn = true; // Helvetica 无法编码（如中文）
        }
      };

      for (const a of p.annots) {
        if (a.type === "draw") {
          for (let i = 1; i < a.points.length; i++) {
            const [x1, y1] = a.points[i - 1];
            const [x2, y2] = a.points[i];
            page.drawLine({
              start: { x: x1 / p.scale, y: H - y1 / p.scale },
              end: { x: x2 / p.scale, y: H - y2 / p.scale },
              thickness: a.width / p.scale,
              color: col(a.color),
            });
          }
        } else if (a.type === "highlight") {
          page.drawRectangle({
            x: a.x / p.scale,
            y: H - (a.y + a.h) / p.scale,
            width: a.w / p.scale,
            height: a.h / p.scale,
            color: col(a.color),
            opacity: 0.35,
          });
        } else if (a.type === "text" || a.type === "whiteout") {
          const el = a.el;
          const x = parseFloat(el.style.left),
            y = parseFloat(el.style.top);
          if (a.whiteout) {
            const w = el.offsetWidth,
              h = el.offsetHeight;
            page.drawRectangle({
              x: x / p.scale,
              y: H - (y + h) / p.scale,
              width: w / p.scale,
              height: h / p.scale,
              color: rgb(1, 1, 1),
            });
            drawText(el, x + 2, y, rgb(0, 0, 0));
          } else {
            drawText(el, x, y, col(state.color === el.style.color ? state.color : "#ff3b30"));
          }
        }
      }
      if (p.rotation) page.setRotation(degrees(p.rotation));
    }

    // 删除页（从后往前）
    const toDelete = state.pages
      .filter((p) => p.deleted)
      .map((p) => p.pageNum - 1)
      .sort((a, b) => b - a);
    for (const idx of toDelete) doc.removePage(idx);

    const out = await doc.save();
    const base64 = bytesToBase64(new Uint8Array(out));
    const r = await window.api.savePdf({
      defaultPath: state.path,
      base64,
    });
    if (r.canceled) setStatus(tr("已取消"));
    else if (r.error) setStatus(tr("保存失败：") + r.error);
    else
      setStatus(
        tr("已保存到 ") + r.path + (cjkWarn ? tr("（注意：非拉丁字符未写入，需嵌入中文字体）") : "")
      );
  } catch (err) {
    setStatus(tr("保存出错：") + (err.message || err));
    console.error(err);
  }
};

// ── 小工具 ─────────────────────────────────────────────────
function local(el, e) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  attr(el, attrs);
  return el;
}
function attr(el, attrs) {
  for (const k in attrs) el.setAttribute(k, attrs[k]);
}
function rectBox(rect) {
  return {
    x: +rect.getAttribute("x"),
    y: +rect.getAttribute("y"),
    w: +rect.getAttribute("width"),
    h: +rect.getAttribute("height"),
  };
}
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

console.log("[pdfeditor] ready, openPdfEditor =", typeof window.openPdfEditor);
