const state = {
  masterRows: [],
  stockRows: [],
  mergedRows: [],
  stoppedCount: 0,
  barcodeLoop: null,
  mediaStream: null,
  html5Scanner: null,
};

const els = {
  masterFile: document.querySelector("#masterFile"),
  stockFile: document.querySelector("#stockFile"),
  mergedFile: document.querySelector("#mergedFile"),
  riskThreshold: document.querySelector("#riskThreshold"),
  installButton: document.querySelector("#installButton"),
  mergeButton: document.querySelector("#mergeButton"),
  loadMergedButton: document.querySelector("#loadMergedButton"),
  mergeStatus: document.querySelector("#mergeStatus"),
  isbnInput: document.querySelector("#isbnInput"),
  findButton: document.querySelector("#findButton"),
  speakButton: document.querySelector("#speakButton"),
  startCameraButton: document.querySelector("#startCameraButton"),
  stopCameraButton: document.querySelector("#stopCameraButton"),
  cameraBox: document.querySelector("#cameraBox"),
  video: document.querySelector("#video"),
  html5Reader: document.querySelector("#html5Reader"),
  answer: document.querySelector("#answer"),
  riskBody: document.querySelector("#riskBody"),
  zeroBody: document.querySelector("#zeroBody"),
  downloadRiskButton: document.querySelector("#downloadRiskButton"),
  downloadZeroButton: document.querySelector("#downloadZeroButton"),
  totalCount: document.querySelector("#totalCount"),
  riskCount: document.querySelector("#riskCount"),
  zeroCount: document.querySelector("#zeroCount"),
  noLocationCount: document.querySelector("#noLocationCount"),
  noStockCount: document.querySelector("#noStockCount"),
  stoppedCount: document.querySelector("#stoppedCount"),
};

let deferredInstallPrompt = null;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((item) => item.some((value) => String(value).trim() !== ""));
}

function toObjects(rows) {
  if (!rows.length) return [];
  const secondRowIsHeader = rows[1] && isRepeatedHeader(rows[1]);
  const headerRow = secondRowIsHeader ? rows[1] : rows[0];
  const dataStart = secondRowIsHeader ? 2 : 1;
  const header = headerRow.map((cell) => normalizeHeader(cell));

  return rows.slice(dataStart)
    .filter((row) => !isRepeatedHeader(row))
    .map((row) => Object.fromEntries(header.map((key, index) => [key, cleanCell(row[index])])));
}

function isRepeatedHeader(row) {
  const joined = row.map((cell) => cleanCell(cell)).join(",");
  return joined.includes("도서명") && joined.includes("창고재고");
}

function normalizeHeader(value) {
  return cleanCell(value).replace(/\s+/g, "");
}

function cleanCell(value) {
  return String(value ?? "").replace(/\uFEFF/g, "").trim();
}

function normalizeTitle(title) {
  return cleanCell(title)
    .replace(/\s*\(([A-Za-z][0-9]{3})\)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLocation(title) {
  const match = cleanCell(title).match(/\(([A-Za-z])([0-9])([0-9])([0-9])\)\s*$/u);
  if (!match) return { code: "", building: "", line: "", position: "", floor: "", text: "위치 정보가 없습니다." };

  const [, building, line, position, floor] = match;
  return {
    code: `${building.toUpperCase()}${line}${position}${floor}`,
    building: building.toUpperCase(),
    line,
    position,
    floor,
    text: `${building.toUpperCase()}동 ${line}번 라인, 앞에서 ${position}번째, ${floor}층`,
  };
}

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentRiskThreshold() {
  const value = Math.floor(numberValue(els.riskThreshold?.value));
  return value > 0 ? value : 50;
}

function isStopped(value) {
  return cleanCell(value).includes("중지");
}

function readCsvFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve([]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(toObjects(parseCsv(String(reader.result || ""))));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "EUC-KR");
  });
}

function mergeRows(masterRows, stockRows) {
  const stockMap = new Map();
  stockRows.forEach((row) => {
    const key = normalizeTitle(row["도서명"]);
    if (!key) return;
    stockMap.set(key, row);
  });

  const threshold = currentRiskThreshold();
  let stoppedCount = 0;
  const mergedRows = [];

  masterRows.forEach((book) => {
    const bookTitle = cleanCell(book["도서명"]);
    const key = normalizeTitle(bookTitle);
    const stock = stockMap.get(key) || {};
    const status = cleanCell(stock["거래상태"] || book["거래중지"]);

    if (isStopped(status)) {
      stoppedCount += 1;
      return;
    }

    const location = extractLocation(bookTitle);
    const warehouseStock = numberValue(stock["창고재고"]);
    const hasStock = Object.keys(stock).length > 0;
    const stockClass = classifyStock(hasStock, warehouseStock, threshold);

    mergedRows.push({
      ISBN: cleanCell(book["ISBN"]).replace(/[^0-9Xx]/g, ""),
      도서명: key || bookTitle,
      원도서명: bookTitle,
      출판사: cleanCell(book["출판사"] || stock["출판사명"]),
      정가: cleanCell(book["정가"] || stock["정가"]),
      위치코드: location.code,
      위치설명: location.text,
      정품: hasStock ? numberValue(stock["정품"]) : "",
      반품: hasStock ? numberValue(stock["반품"]) : "",
      창고재고: hasStock ? warehouseStock : "",
      재고구분: stockClass,
      위험재고: stockClass === "위험" ? "위험" : "",
      거래상태: status,
      재고매칭: hasStock ? "일치" : "재고없음",
    });
  });

  state.stoppedCount = stoppedCount;
  return mergedRows;
}

function classifyStock(hasStock, warehouseStock, threshold) {
  if (!hasStock) return "";
  if (warehouseStock === 0) return "0재고";
  if (warehouseStock > 0 && warehouseStock <= threshold) return "위험";
  return "";
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => csvCell(row[header])).join(","));
  return [headers.join(","), ...body].join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const blob = new Blob(["\uFEFF", toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function todayStamp() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function refreshStockClasses() {
  const threshold = currentRiskThreshold();
  state.mergedRows.forEach((row) => {
    const hasStock = row["창고재고"] !== "";
    const stock = numberValue(row["창고재고"]);
    const stockClass = classifyStock(hasStock, stock, threshold);
    row["재고구분"] = stockClass;
    row["위험재고"] = stockClass === "위험" ? "위험" : "";
  });
}

function renderDashboard() {
  refreshStockClasses();
  const rows = state.mergedRows;
  const riskRows = rows.filter((row) => row["재고구분"] === "위험");
  const zeroRows = rows.filter((row) => row["재고구분"] === "0재고");
  const noLocationRows = rows.filter((row) => !row["위치코드"]);
  const noStockRows = rows.filter((row) => row["재고매칭"] === "재고없음");

  els.totalCount.textContent = rows.length.toLocaleString("ko-KR");
  els.riskCount.textContent = riskRows.length.toLocaleString("ko-KR");
  els.zeroCount.textContent = zeroRows.length.toLocaleString("ko-KR");
  els.noLocationCount.textContent = noLocationRows.length.toLocaleString("ko-KR");
  els.noStockCount.textContent = noStockRows.length.toLocaleString("ko-KR");
  els.stoppedCount.textContent = state.stoppedCount.toLocaleString("ko-KR");

  els.riskBody.innerHTML = "";
  els.zeroBody.innerHTML = "";
  renderStockRows(els.riskBody, riskRows);
  renderStockRows(els.zeroBody, zeroRows);

  els.downloadRiskButton.disabled = riskRows.length === 0;
  els.downloadZeroButton.disabled = zeroRows.length === 0;
}

function renderStockRows(body, rows) {
  rows
    .sort((a, b) => numberValue(a["창고재고"]) - numberValue(b["창고재고"]))
    .slice(0, 300)
    .forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row["ISBN"])}</td>
        <td><strong>${escapeHtml(row["도서명"])}</strong><br><span class="publisher">${escapeHtml(row["출판사"])}</span></td>
        <td>${escapeHtml(row["출판사"])}</td>
        <td>${escapeHtml(row["창고재고"])}</td>
        <td>${escapeHtml(row["위치코드"])}</td>
        <td>${escapeHtml(row["위치설명"])}</td>
      `;
      body.appendChild(tr);
    });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lookup(isbn) {
  const code = cleanCell(isbn).replace(/[^0-9Xx]/g, "");
  if (!code) return null;
  return state.mergedRows.find((row) => row["ISBN"] === code);
}

function resultText(row) {
  if (!row) return "해당 ISBN의 도서를 찾지 못했습니다.";
  const publisher = row["출판사"] ? `출판사는 ${row["출판사"]}입니다. ` : "";
  const stock = row["창고재고"] === "" ? "재고 정보 없음" : `창고재고 ${row["창고재고"]}부`;
  return `${row["도서명"]}. ${publisher}${row["위치설명"]}에 있습니다. ${stock}.`;
}

function showResult(row) {
  if (!row) {
    els.answer.innerHTML = `<strong>조회 결과 없음</strong><p>ISBN을 다시 확인하거나 통합재고 파일을 다시 올려주세요.</p>`;
    return;
  }
  const stock = row["창고재고"] === "" ? "재고 정보 없음" : `${row["창고재고"]}부`;
  const stockClass = row["재고구분"] === "위험" || row["재고구분"] === "0재고" ? "stock-risk" : "stock-safe";
  els.answer.innerHTML = `
    <strong>${escapeHtml(row["도서명"])}</strong>
    <p class="publisher">${escapeHtml(row["출판사"])}</p>
    <p>${escapeHtml(row["위치설명"])}</p>
    <p>ISBN ${escapeHtml(row["ISBN"])} · <span class="${stockClass}">${escapeHtml(stock)}</span></p>
  `;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ko-KR";
  utterance.rate = 1.15;
  window.speechSynthesis.speak(utterance);
}

async function startCamera() {
  if (!("BarcodeDetector" in window)) {
    await startHtml5Scanner();
    return;
  }

  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39"] });
  state.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  els.video.style.display = "block";
  els.html5Reader.style.display = "none";
  els.video.srcObject = state.mediaStream;
  els.cameraBox.style.display = "block";
  els.startCameraButton.disabled = true;
  els.stopCameraButton.disabled = false;

  const scan = async () => {
    if (!state.mediaStream) return;
    try {
      const codes = await detector.detect(els.video);
      if (codes.length) {
        const value = codes[0].rawValue;
        els.isbnInput.value = value;
        findAndSpeak(value);
        stopCamera();
        return;
      }
    } catch (error) {
      console.warn(error);
    }
    state.barcodeLoop = window.requestAnimationFrame(scan);
  };

  state.barcodeLoop = window.requestAnimationFrame(scan);
}

function stopCamera() {
  if (state.barcodeLoop) window.cancelAnimationFrame(state.barcodeLoop);
  state.barcodeLoop = null;
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
  }
  state.mediaStream = null;
  els.video.srcObject = null;
  if (state.html5Scanner) {
    state.html5Scanner.stop().catch(() => undefined);
    state.html5Scanner.clear().catch(() => undefined);
    state.html5Scanner = null;
  }
  els.cameraBox.style.display = "none";
  els.startCameraButton.disabled = false;
  els.stopCameraButton.disabled = true;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      if (window.Html5Qrcode) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function startHtml5Scanner() {
  try {
    await loadScript("https://unpkg.com/html5-qrcode/minified/html5-qrcode.min.js");
  } catch (error) {
    alert("이 브라우저는 카메라 스캔 기능을 불러오지 못했습니다. 수동입력 또는 키보드형 스캐너를 사용해주세요.");
    return;
  }

  if (!window.Html5Qrcode) {
    alert("카메라 스캔 모듈을 사용할 수 없습니다. 수동입력을 사용해주세요.");
    return;
  }

  els.video.style.display = "none";
  els.html5Reader.style.display = "block";
  els.cameraBox.style.display = "block";
  els.startCameraButton.disabled = true;
  els.stopCameraButton.disabled = false;

  const formats = window.Html5QrcodeSupportedFormats
    ? [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128]
    : undefined;
  state.html5Scanner = new Html5Qrcode("html5Reader", false);
  await state.html5Scanner.start(
    { facingMode: "environment" },
    { fps: 12, qrbox: { width: 260, height: 160 }, formatsToSupport: formats },
    (decodedText) => {
      els.isbnInput.value = decodedText;
      findAndSpeak(decodedText);
      stopCamera();
    },
    () => undefined,
  );
}

function findAndSpeak(value) {
  const row = lookup(value);
  showResult(row);
  speak(resultText(row));
}

els.mergeButton.addEventListener("click", async () => {
  try {
    els.mergeStatus.textContent = "파일을 읽고 통합하고 있습니다.";
    state.masterRows = await readCsvFile(els.masterFile.files[0]);
    state.stockRows = await readCsvFile(els.stockFile.files[0]);

    if (!state.masterRows.length || !state.stockRows.length) {
      els.mergeStatus.textContent = "도서관리 CSV와 재고현황 CSV를 모두 선택해주세요.";
      return;
    }

    state.mergedRows = mergeRows(state.masterRows, state.stockRows);
    downloadCsv(`통합재고_${todayStamp()}.csv`, state.mergedRows);
    renderDashboard();
    els.mergeStatus.textContent = `통합 완료: ${state.mergedRows.length.toLocaleString("ko-KR")}권. 중지 ${state.stoppedCount.toLocaleString("ko-KR")}권은 제외했습니다.`;
  } catch (error) {
    console.error(error);
    els.mergeStatus.textContent = "통합 중 오류가 났습니다. CSV 파일 형식을 확인해주세요.";
  }
});

els.loadMergedButton.addEventListener("click", async () => {
  const rows = await readCsvFile(els.mergedFile.files[0]);
  if (!rows.length) {
    els.mergeStatus.textContent = "통합재고 CSV를 선택해주세요.";
    return;
  }
  state.mergedRows = rows.filter((row) => !isStopped(row["거래상태"]));
  state.stoppedCount = rows.length - state.mergedRows.length;
  renderDashboard();
  els.mergeStatus.textContent = `통합재고 ${state.mergedRows.length.toLocaleString("ko-KR")}권을 불러왔습니다.`;
});

els.findButton.addEventListener("click", () => findAndSpeak(els.isbnInput.value));
els.speakButton.addEventListener("click", () => speak(resultText(lookup(els.isbnInput.value))));
els.startCameraButton.addEventListener("click", () => startCamera().catch((error) => alert(`카메라를 열 수 없습니다: ${error.message}`)));
els.stopCameraButton.addEventListener("click", stopCamera);
els.downloadRiskButton.addEventListener("click", () => {
  renderDashboard();
  downloadCsv(`위험재고_${todayStamp()}.csv`, state.mergedRows.filter((row) => row["재고구분"] === "위험"));
});
els.downloadZeroButton.addEventListener("click", () => {
  renderDashboard();
  downloadCsv(`0재고_${todayStamp()}.csv`, state.mergedRows.filter((row) => row["재고구분"] === "0재고"));
});
els.riskThreshold.addEventListener("input", renderDashboard);
els.riskThreshold.addEventListener("change", renderDashboard);

els.isbnInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    findAndSpeak(els.isbnInput.value);
    els.isbnInput.select();
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  els.installButton.hidden = false;
});

els.installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installButton.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  els.installButton.hidden = true;
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}
