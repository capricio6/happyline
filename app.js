const state = {
  masterRows: [],
  stockRows: [],
  mergedRows: [],
  stoppedCount: 0,
  barcodeLoop: null,
  mediaStream: null,
  html5Scanner: null,
  zxingReader: null,
};

const HOSTED_STOCK_FILE = "./merged-stock.csv";

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
  startCameraButton: document.querySelector("#startCameraButton"),
  stopCameraButton: document.querySelector("#stopCameraButton"),
  photoScanButton: document.querySelector("#photoScanButton"),
  photoInput: document.querySelector("#photoInput"),
  cameraBox: document.querySelector("#cameraBox"),
  video: document.querySelector("#video"),
  html5Reader: document.querySelector("#html5Reader"),
  answer: document.querySelector("#answer"),
  riskBody: document.querySelector("#riskBody"),
  zeroBody: document.querySelector("#zeroBody"),
  downloadRiskButton: document.querySelector("#downloadRiskButton"),
  downloadZeroButton: document.querySelector("#downloadZeroButton"),
  showAllRiskButton: document.querySelector("#showAllRiskButton"),
  selectedRiskOnly: document.querySelector("#selectedRiskOnly"),
  totalCount: document.querySelector("#totalCount"),
  riskCount: document.querySelector("#riskCount"),
  zeroCount: document.querySelector("#zeroCount"),
  noLocationCount: document.querySelector("#noLocationCount"),
  noStockCount: document.querySelector("#noStockCount"),
  stoppedCount: document.querySelector("#stoppedCount"),
};

let deferredInstallPrompt = null;
const RISK_EXCLUDED_KEY = "bookStockRiskExcludedIsbns";
const RISK_SELECTED_ONLY_KEY = "bookStockSelectedRiskOnly";

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

// 전각 괄호·대괄호류를 ASCII 소괄호로 통일 (한글 IME 입력 대응)
function unifyBrackets(text) {
  return String(text ?? "")
    .replace(/[（〔【［]/g, "(")
    .replace(/[）〕】］]/g, ")");
}

// 위치코드 후보: (창고동 글자)(가로줄 문자, 선택) + 숫자
//  - 창고동: 영문 1글자(대문자 규칙) 또는 한글 1글자
//  - 가로줄: 소문자 영문 1글자(선택) — 없으면 숫자 첫자리가 가로줄
//  - 괄호 안팎 공백, 글자-숫자 사이 공백/하이픈 허용
const LOC_CODE_RE = /\(\s*([A-Za-z]|[가-힣])([A-Za-z])?\s*[-\s]?\s*([0-9]{1,4})\s*\)/gu;
// 제목 끝에 붙은 위치코드 1개를 떼기 위한 패턴
const LOC_CODE_TAIL_RE = /\s*\(\s*(?:[A-Za-z]|[가-힣])(?:[A-Za-z])?\s*[-\s]?\s*[0-9]{1,4}\s*\)\s*$/u;

function normalizeTitle(title) {
  const unified = unifyBrackets(cleanCell(title));
  // 끝에 붙은 코드를 우선 제거, 없으면 제목 안의 마지막 코드 후보 1개를 제거
  let stripped = unified.replace(LOC_CODE_TAIL_RE, "");
  if (stripped === unified) {
    const matches = [...unified.matchAll(LOC_CODE_RE)];
    if (matches.length) {
      const last = matches[matches.length - 1];
      stripped = unified.slice(0, last.index) + unified.slice(last.index + last[0].length);
    }
  }
  return stripped.replace(/\s+/g, " ").trim();
}

// 세로줄 차례 표기. from은 방향 표현('왼쪽에서' 또는 '앞에서')
const COL_ORDINALS = ["", "첫", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
function colText(n, from) {
  const word = COL_ORDINALS[Number(n)];
  return word ? `${from} ${word}번째` : `${from} ${n}번째`;
}
// 가로줄을 숫자로 쓴 경우 a,b,c… 문자로 변환 (1→a, 2→b …)
function rowLetterFromDigit(d) {
  const i = Number(d);
  return (i >= 1 && i <= 26) ? String.fromCharCode(96 + i) : String(d);
}

// 위치코드 구조: 창고동 / 가로줄(줄) / 세로줄 / 층
//  - 가로줄: 소문자 문자(b) 또는 숫자 첫자리(1→a)로 표기
//  - 가로줄 뒤 남은 숫자가 2자리면 [세로줄, 층] → '왼쪽에서 N번째'
//  - 가로줄 뒤 남은 숫자가 1자리면 [층]만 → 세로줄은 한 줄뿐이므로 '앞에서부터 첫번째' 기본값
//  예) Ab11 → A동 b줄 왼쪽에서 첫번째 1층 / A11 → A동 a줄 앞에서부터 첫번째 1층
function buildLocation(buildingRaw, rowLetterRaw, digits) {
  const building = /[A-Za-z]/.test(buildingRaw) ? buildingRaw.toUpperCase() : buildingRaw;
  const rowLetter = rowLetterRaw ? rowLetterRaw.toLowerCase() : "";
  const code = `${building}${rowLetter}${digits}`;

  // 가로줄 결정: 문자가 있으면 그 문자, 없으면 숫자 첫자리를 a,b,c…로 변환
  let row;
  let rest;
  if (rowLetter) {
    row = rowLetter;
    rest = digits;
  } else if (digits.length >= 1) {
    row = rowLetterFromDigit(digits[0]);
    rest = digits.slice(1);
  } else {
    row = "";
    rest = "";
  }

  // 남은 숫자 2자리 = 세로줄 + 층 (세로줄은 왼쪽에서 N번째)
  if (row && rest.length === 2) {
    const [col, floor] = rest.split("");
    return {
      code,
      building,
      row,
      col,
      floor,
      text: `${building}동 ${row}줄, ${colText(col)}, ${floor}층`,
    };
  }

  // 남은 숫자 1자리 = 층만 (세로줄 한 줄뿐 → 앞에서부터 첫번째 기본값)
  if (row && rest.length === 1) {
    const floor = rest;
    return {
      code,
      building,
      row,
      col: "1",
      floor,
      text: `${building}동 ${row}줄, 앞에서부터 첫번째, ${floor}층`,
    };
  }

  // 규칙에서 벗어난 자릿수: 코드는 그대로 보존하고 일반 표기 (누락 방지)
  return {
    code,
    building,
    row: rowLetter,
    col: "",
    floor: "",
    text: `${building}동 ${rowLetter}${digits} (위치코드)`,
  };
}

function extractLocation(title) {
  const raw = unifyBrackets(cleanCell(title));
  const candidates = [...raw.matchAll(LOC_CODE_RE)];
  if (!candidates.length) {
    return { code: "", building: "", line: "", position: "", floor: "", text: "위치 정보가 없습니다." };
  }
  // 제목 안에 여러 개면 가장 마지막(보통 끝에 붙은 것)을 위치코드로 채택
  const last = candidates[candidates.length - 1];
  return buildLocation(last[1], last[2], last[3]);
}

function locationFromCode(code) {
  const match = unifyBrackets(cleanCell(code))
    .match(/^\s*([A-Za-z]|[가-힣])([A-Za-z])?\s*[-\s]?\s*([0-9]{1,4})\s*$/u);
  if (!match) return null;
  return buildLocation(match[1], match[2], match[3]);
}

function normalizeRowLocation(row) {
  const fromCode = locationFromCode(row["위치코드"]);
  if (fromCode) {
    row["위치코드"] = fromCode.code;
    row["위치설명"] = fromCode.text;
    return;
  }

  const fromTitle = extractLocation(row["원도서명"] || row["도서명"]);
  if (fromTitle.code) {
    row["위치코드"] = fromTitle.code;
    row["위치설명"] = fromTitle.text;
  } else if (!row["위치설명"] || !cleanCell(row["위치설명"]).includes("동")) {
    row["위치설명"] = "위치 정보가 없습니다.";
  }
}

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentRiskThreshold() {
  const value = Math.floor(numberValue(els.riskThreshold?.value));
  return value > 0 ? value : 200;
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

async function readHostedCsv(url) {
  const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  if (utf8Text.includes("�")) {
    return toObjects(parseCsv(new TextDecoder("euc-kr").decode(buffer)));
  }
  return toObjects(parseCsv(utf8Text));
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
    normalizeRowLocation(row);
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
  const selectedRiskRows = riskRows.filter((row) => isRiskSelected(row["ISBN"]));
  const visibleRiskRows = els.selectedRiskOnly.checked ? selectedRiskRows : riskRows;
  const zeroRows = rows.filter((row) => row["재고구분"] === "0재고");
  const noLocationRows = rows.filter((row) => !row["위치코드"]);
  const noStockRows = rows.filter((row) => row["재고매칭"] === "재고없음");

  els.totalCount.textContent = rows.length.toLocaleString("ko-KR");
  els.riskCount.textContent = selectedRiskRows.length === riskRows.length
    ? riskRows.length.toLocaleString("ko-KR")
    : `${selectedRiskRows.length.toLocaleString("ko-KR")}/${riskRows.length.toLocaleString("ko-KR")}`;
  els.zeroCount.textContent = zeroRows.length.toLocaleString("ko-KR");
  els.noLocationCount.textContent = noLocationRows.length.toLocaleString("ko-KR");
  els.noStockCount.textContent = noStockRows.length.toLocaleString("ko-KR");
  els.stoppedCount.textContent = state.stoppedCount.toLocaleString("ko-KR");

  els.riskBody.innerHTML = "";
  els.zeroBody.innerHTML = "";
  renderStockRows(els.riskBody, visibleRiskRows, { selectable: true });
  renderStockRows(els.zeroBody, zeroRows, { selectable: false });

  els.downloadRiskButton.disabled = selectedRiskRows.length === 0;
  els.downloadZeroButton.disabled = zeroRows.length === 0;
}

function renderStockRows(body, rows, options = {}) {
  rows
    .sort((a, b) => numberValue(a["창고재고"]) - numberValue(b["창고재고"]))
    .slice(0, 300)
    .forEach((row) => {
      const tr = document.createElement("tr");
      const manageCell = options.selectable
        ? `<td class="manage-cell"><input type="checkbox" class="risk-select" data-isbn="${escapeHtml(row["ISBN"])}" ${isRiskSelected(row["ISBN"]) ? "checked" : ""} aria-label="관리할 위험재고 선택"></td>`
        : "";
      tr.innerHTML = `
        ${manageCell}
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

async function startCamera() {
  // 1) 카메라 권한 사전 확인 (iOS에서 명확한 에러 메시지 출력)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("이 브라우저는 카메라를 지원하지 않습니다.\n\n[해결]\n- HTTPS 주소(https://...)인지 확인\n- iPhone: Safari로 열기 (Chrome/Naver/Kakao 인앱 X)\n- Android: 최신 Chrome 사용");
    throw new Error("getUserMedia unsupported");
  }

  // iOS 홈화면(standalone) PWA에서는 getUserMedia가 막히는 WebKit 버그가 있어 사전 경고
  if (isIOS() && isStandalone()) {
    alert("아이폰 '홈 화면에 추가'(앱) 상태에서는 iOS 정책상 카메라가 동작하지 않을 수 있습니다.\n\n스캔이 안 되면 이 페이지를 Safari 브라우저로 직접 열어주세요.\n(Safari 주소창에 배포 주소 입력 → 카메라 허용)");
  }

  // iOS는 카메라를 두 번 여닫으면 NotReadableError가 잦으므로 probe를 생략하고
  // 스캐너가 카메라를 단 한 번만 열도록 한다 (html5-qrcode 알려진 이슈 회피).
  if (isIOS()) {
    try {
      await startHtml5Scanner();
      return;
    } catch (error) {
      console.warn("Html5Qrcode failed on iOS, fallback to ZXing", error);
    }
    try {
      await startZxingScanner();
      return;
    } catch (error) {
      const denied = error && (error.name === "NotAllowedError" || /denied|permission/i.test(error.message || ""));
      alert(denied
        ? "카메라 권한이 거부되었습니다.\n\n[iPhone]\n설정 > Safari > 카메라 > '허용'\n그 다음 Safari를 새로고침하세요.\n홈 화면 앱이면 Safari로 직접 열어주세요."
        : `스캐너 초기화 실패: ${error?.message || error}\n\nSafari로 열었는지, HTTPS 주소인지, 네트워크가 정상인지 확인해주세요.`);
      throw error;
    }
  }

  // Android/PC는 기존대로 권한을 먼저 확인해 명확한 메시지를 제공한다.
  try {
    const probeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    probeStream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const msg = error && error.name === "NotAllowedError"
      ? "카메라 권한이 거부되었습니다.\n\n주소창 옆 자물쇠 > 사이트 설정 > 카메라 허용으로 바꾼 뒤 새로고침해주세요."
      : `카메라를 열 수 없습니다: ${error?.message || error}\n\nHTTPS 주소인지, 다른 앱이 카메라를 점유 중인지 확인해주세요.`;
    alert(msg);
    throw error;
  }

  // Android/PC: BarcodeDetector 네이티브 우선 (가장 빠름)
  if ("BarcodeDetector" in window) {
    try {
      await startNativeBarcodeDetector();
      return;
    } catch (error) {
      console.warn("Native BarcodeDetector failed, fallback to Html5Qrcode", error);
    }
  }

  // 최후 fallback
  try {
    await startHtml5Scanner();
  } catch (error) {
    console.warn("Html5Qrcode failed, fallback to ZXing", error);
    await startZxingScanner();
  }
}

async function startNativeBarcodeDetector() {
  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39"] });
  state.mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });
  els.video.style.display = "block";
  els.html5Reader.style.display = "none";
  els.video.srcObject = state.mediaStream;
  els.video.setAttribute("playsinline", "true");
  els.video.setAttribute("muted", "true");
  await els.video.play().catch(() => undefined);
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
        findAndShow(value);
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
  if (els.video) {
    try { els.video.pause(); } catch (e) { /* ignore */ }
    els.video.srcObject = null;
  }
  if (state.html5Scanner) {
    state.html5Scanner.stop().catch(() => undefined).finally(() => {
      try { state.html5Scanner && state.html5Scanner.clear(); } catch (e) { /* ignore */ }
      state.html5Scanner = null;
    });
  }
  if (state.zxingReader) {
    try {
      state.zxingReader.reset();
    } catch (error) {
      console.warn(error);
    }
    state.zxingReader = null;
  }
  els.cameraBox.style.display = "none";
  els.startCameraButton.disabled = false;
  els.stopCameraButton.disabled = true;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
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

async function loadScannerScript() {
  if (window.Html5Qrcode) return;
  // 안정 버전 고정 + 다중 CDN fallback (CDN 장애 시에도 동작)
  const sources = [
    "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js",
    "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
    "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
    "https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
  ];

  for (const src of sources) {
    try {
      await loadScript(src);
      if (window.Html5Qrcode) return;
    } catch (error) {
      console.warn("Scanner script failed", src, error);
    }
  }
  throw new Error("scanner script unavailable");
}

async function loadTesseractScript() {
  if (window.Tesseract) return;
  const sources = [
    "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    "https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js",
  ];
  for (const src of sources) {
    try {
      await loadScript(src);
      if (window.Tesseract) return;
    } catch (error) {
      console.warn("Tesseract script failed", src, error);
    }
  }
  throw new Error("Tesseract unavailable");
}

async function loadZxingScript() {
  if (window.ZXing?.BrowserMultiFormatReader) return;
  // 안정 버전 고정 (0.21.3은 검증된 안정 버전)
  const sources = [
    "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js",
    "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js",
    "https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js",
  ];

  for (const src of sources) {
    try {
      await loadScript(src);
      if (window.ZXing?.BrowserMultiFormatReader) return;
    } catch (error) {
      console.warn("ZXing script failed", src, error);
    }
  }
  throw new Error("ZXing unavailable");
}

async function startHtml5Scanner() {
  try {
    await loadScannerScript();
  } catch (error) {
    throw new Error("스캐너 라이브러리 로드 실패. 인터넷 연결을 확인해주세요.");
  }

  if (!window.Html5Qrcode) {
    throw new Error("스캐너 모듈을 사용할 수 없습니다.");
  }

  els.video.style.display = "none";
  els.html5Reader.style.display = "block";
  els.cameraBox.style.display = "block";
  els.startCameraButton.disabled = true;
  els.stopCameraButton.disabled = false;

  const formats = window.Html5QrcodeSupportedFormats
    ? [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
      ]
    : undefined;
  state.html5Scanner = new Html5Qrcode("html5Reader", { verbose: false });

  const onScan = (decodedText) => {
    els.isbnInput.value = decodedText;
    findAndShow(decodedText);
    stopCamera();
  };

  // iOS Safari에서는 후면 카메라 자동 감지가 불안정 → facingMode 우선 사용
  const config = {
    fps: 10,
    qrbox: { width: 280, height: 160 }, // ISBN 바코드는 가로로 길어 직사각형이 유리
    aspectRatio: window.innerWidth > window.innerHeight ? 1.7777 : 1.0,
    disableFlip: false,
    formatsToSupport: formats,
    videoConstraints: {
      facingMode: { ideal: "environment" },
    },
  };

  try {
    // 가장 호환성 높은 방법: facingMode로 시작
    await state.html5Scanner.start(
      { facingMode: { ideal: "environment" } },
      config,
      onScan,
      () => undefined,
    );
  } catch (error) {
    console.warn("facingMode start failed, trying device enumeration", error);
    // facingMode 실패 시 카메라 ID로 재시도
    const cameras = await Html5Qrcode.getCameras().catch(() => []);
    if (!cameras.length) {
      throw new Error("사용 가능한 카메라가 없습니다.");
    }
    const backCamera = cameras.find((camera) => /back|rear|environment|후면/i.test(camera.label)) || cameras[cameras.length - 1];
    await state.html5Scanner.start(backCamera.id, config, onScan, () => undefined);
  }
}

async function startZxingScanner() {
  try {
    await loadZxingScript();
  } catch (error) {
    throw new Error("ZXing 라이브러리 로드 실패. 네트워크를 확인해주세요.");
  }

  els.video.style.display = "block";
  els.html5Reader.style.display = "none";
  els.cameraBox.style.display = "block";
  els.startCameraButton.disabled = true;
  els.stopCameraButton.disabled = false;

  // iOS 필수 속성 보장
  els.video.setAttribute("playsinline", "true");
  els.video.setAttribute("muted", "true");
  els.video.setAttribute("autoplay", "true");

  // hints로 EAN_13(ISBN) 우선 인식 → 인식 속도 향상
  const hints = buildZxingHints();
  state.zxingReader = new ZXing.BrowserMultiFormatReader(hints, 500);

  const onDecode = (result, error) => {
    if (!result) return;
    const value = typeof result.getText === "function" ? result.getText() : result.text;
    if (!value) return;
    els.isbnInput.value = value;
    findAndShow(value);
    stopCamera();
  };

  if (typeof state.zxingReader.decodeFromConstraints === "function") {
    await state.zxingReader.decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      els.video,
      onDecode,
    );
    return;
  }

  await state.zxingReader.decodeFromVideoDevice(undefined, els.video, onDecode);
}

// ZXing 디코딩 힌트(ISBN=EAN_13 우선 + TRY_HARDER)를 공통으로 생성
function buildZxingHints() {
  if (!(window.ZXing?.DecodeHintType && window.ZXing?.BarcodeFormat)) return null;
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return hints;
}

// EAN-13(ISBN-13) 체크섬 검증 → OCR 오인식을 걸러냄
function isValidEan13(s) {
  if (!/^[0-9]{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

// OCR로 읽은 텍스트에서 유효한 13자리 ISBN을 찾음 (978/979 우선)
function findIsbnFromText(text) {
  const digits = String(text || "").replace(/[^0-9]/g, "");
  for (const prefix of ["978", "979"]) {
    let idx = digits.indexOf(prefix);
    while (idx !== -1) {
      const cand = digits.slice(idx, idx + 13);
      if (cand.length === 13 && isValidEan13(cand)) return cand;
      idx = digits.indexOf(prefix, idx + 1);
    }
  }
  for (let i = 0; i + 13 <= digits.length; i += 1) {
    const cand = digits.slice(i, i + 13);
    if (isValidEan13(cand)) return cand;
  }
  return null;
}

// 바코드 아래 숫자를 OCR로 읽기 (아이폰에서 바코드 디코딩이 실패할 때의 최후 수단)
async function ocrDecodeImage(file) {
  await loadTesseractScript();
  const worker = await Tesseract.createWorker("eng");
  try {
    await worker.setParameters({ tessedit_char_whitelist: "0123456789" });
    const { data } = await worker.recognize(file);
    return findIsbnFromText(data && data.text);
  } finally {
    try { await worker.terminate(); } catch (e) { /* ignore */ }
  }
}

// 정지 사진 1장에서 바코드를 디코딩 (iOS에서 가장 안정적인 경로)
// 우선순위: 네이티브 BarcodeDetector(안드로이드) → ZXing → html5-qrcode scanFile
async function decodeImageFile(file) {
  // 1) BarcodeDetector: 이미지에서 직접 디코딩 (Android/Chrome 계열)
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"],
      });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      if (bitmap.close) bitmap.close();
      if (codes && codes.length) return codes[0].rawValue;
    } catch (error) {
      console.warn("BarcodeDetector image decode failed", error);
    }
  }

  // 2) ZXing 정지영상 디코딩 (iOS Safari 포함 대부분에서 동작)
  try {
    await loadZxingScript();
    const reader = new ZXing.BrowserMultiFormatReader(buildZxingHints());
    const url = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(url);
      const value = typeof result.getText === "function" ? result.getText() : result.text;
      if (value) return value;
    } finally {
      URL.revokeObjectURL(url);
      try { reader.reset(); } catch (e) { /* ignore */ }
    }
  } catch (error) {
    console.warn("ZXing image decode failed", error);
  }

  // 3) html5-qrcode scanFile fallback
  try {
    await loadScannerScript();
    let holder = document.getElementById("photoScanTmp");
    if (!holder) {
      holder = document.createElement("div");
      holder.id = "photoScanTmp";
      holder.style.display = "none";
      document.body.appendChild(holder);
    }
    const scanner = new Html5Qrcode("photoScanTmp", { verbose: false });
    try {
      const text = await scanner.scanFile(file, false);
      if (text) return text;
    } finally {
      try { scanner.clear(); } catch (e) { /* ignore */ }
    }
  } catch (error) {
    console.warn("html5-qrcode scanFile failed", error);
  }

  // 4) OCR: 바코드 아래 숫자 읽기 (최후 수단, 아이폰에서 특히 유용)
  try {
    els.answer.innerHTML = `<strong>바코드 숫자를 읽는 중…</strong><p>처음 한 번은 인식 엔진을 내려받느라 시간이 걸릴 수 있습니다. 잠시만 기다려주세요.</p>`;
    const isbn = await ocrDecodeImage(file);
    if (isbn) return isbn;
  } catch (error) {
    console.warn("OCR decode failed", error);
  }

  return null;
}

async function handlePhotoScan(file) {
  if (!file) return;
  els.answer.innerHTML = `<strong>사진에서 바코드를 읽는 중…</strong><p>잠시만 기다려주세요.</p>`;
  try {
    const value = await decodeImageFile(file);
    if (!value) {
      els.answer.innerHTML = `<strong>바코드를 못 읽었습니다</strong><p>바코드가 화면에 크고 또렷하게 보이도록 더 가까이서, 밝은 곳에서 다시 촬영해주세요. 손떨림이 있으면 인식이 어렵습니다.</p>`;
      return;
    }
    els.isbnInput.value = value;
    findAndShow(value);
  } catch (error) {
    console.error(error);
    els.answer.innerHTML = `<strong>사진 인식 오류</strong><p>${escapeHtml(error?.message || String(error))}</p>`;
  } finally {
    els.photoInput.value = ""; // 같은 파일을 다시 선택할 수 있도록 초기화
  }
}

function findAndShow(value) {
  const row = lookup(value);
  showResult(row);
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
    downloadCsv("merged-stock.csv", state.mergedRows);
    renderDashboard();
    els.mergeStatus.textContent = `통합 완료: ${state.mergedRows.length.toLocaleString("ko-KR")}권. 중지 ${state.stoppedCount.toLocaleString("ko-KR")}권은 제외했습니다. 내려받은 merged-stock.csv를 GitHub 저장소 맨 위에 올리면 모든 기기에서 자동으로 읽습니다.`;
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

async function loadHostedStock() {
  try {
    const rows = await readHostedCsv(HOSTED_STOCK_FILE);
    state.mergedRows = rows.filter((row) => !isStopped(row["거래상태"]));
    state.stoppedCount = rows.length - state.mergedRows.length;
    renderDashboard();
    els.mergeStatus.textContent = `공유 통합재고 ${state.mergedRows.length.toLocaleString("ko-KR")}권을 자동으로 불러왔습니다.`;
  } catch (error) {
    els.mergeStatus.textContent = "공유 통합재고가 아직 없습니다. 이 PC에서 통합재고를 만든 뒤 merged-stock.csv를 GitHub 저장소에 올려주세요.";
  }
}

els.findButton.addEventListener("click", () => findAndShow(els.isbnInput.value));
els.photoScanButton.addEventListener("click", () => els.photoInput.click());
els.photoInput.addEventListener("change", () => handlePhotoScan(els.photoInput.files[0]));
els.startCameraButton.addEventListener("click", () => startCamera().catch((error) => {
  console.warn("Camera start failed", error);
  // startCamera 내부에서 이미 alert를 띄웠으므로 여기서는 버튼 상태만 복구
  els.startCameraButton.disabled = false;
  els.stopCameraButton.disabled = true;
  els.cameraBox.style.display = "none";
}));
els.stopCameraButton.addEventListener("click", stopCamera);
els.downloadRiskButton.addEventListener("click", () => {
  renderDashboard();
  downloadCsv(`위험재고_${todayStamp()}.csv`, state.mergedRows.filter((row) => row["재고구분"] === "위험" && isRiskSelected(row["ISBN"])));
});
els.downloadZeroButton.addEventListener("click", () => {
  renderDashboard();
  downloadCsv(`0재고_${todayStamp()}.csv`, state.mergedRows.filter((row) => row["재고구분"] === "0재고"));
});
els.riskThreshold.addEventListener("input", renderDashboard);
els.riskThreshold.addEventListener("change", renderDashboard);
els.selectedRiskOnly.checked = localStorage.getItem(RISK_SELECTED_ONLY_KEY) === "1";
els.selectedRiskOnly.addEventListener("change", () => {
  localStorage.setItem(RISK_SELECTED_ONLY_KEY, els.selectedRiskOnly.checked ? "1" : "0");
  renderDashboard();
});
els.showAllRiskButton.addEventListener("click", () => {
  els.selectedRiskOnly.checked = false;
  localStorage.setItem(RISK_SELECTED_ONLY_KEY, "0");
  renderDashboard();
});
els.riskBody.addEventListener("change", (event) => {
  if (!event.target.classList.contains("risk-select")) return;
  setRiskSelected(event.target.dataset.isbn, event.target.checked);
  renderDashboard();
});

els.isbnInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    findAndShow(els.isbnInput.value);
    els.isbnInput.select();
  }
});

// 자동 Enter 처리: ISBN이 "완성"된 형태일 때만 자동 조회
// - ISBN-13: 13자리 숫자 (한국 도서 표준)
// - ISBN-10: 10자리 숫자 또는 9자리 + X (구형, 안전망)
// 미완성(예: 9자리)에서는 절대 자동 발동하지 않음
// 키보드형 스캐너(USB/Bluetooth)는 거의 모두 Enter를 자동 송신하므로 별도 휴리스틱 불필요
let autoSubmitTimer = null;
els.isbnInput.addEventListener("input", () => {
  const raw = els.isbnInput.value.trim();
  const cleaned = raw.replace(/[^0-9Xx]/g, "");

  const isComplete = /^[0-9]{13}$/.test(cleaned)
    || /^[0-9]{10}$/.test(cleaned)
    || /^[0-9]{9}[Xx]$/.test(cleaned);

  if (autoSubmitTimer) clearTimeout(autoSubmitTimer);
  if (!isComplete) return;

  // 200ms 디바운스 + 값 안정성 재확인: 그 사이 추가 입력이 있으면 취소되어
  // 13자리를 넘는 추가 입력(예: 14, 15자리)에서 잘못 발동하지 않음
  const snapshot = cleaned;
  autoSubmitTimer = setTimeout(() => {
    const current = els.isbnInput.value.trim().replace(/[^0-9Xx]/g, "");
    if (current === snapshot) {
      findAndShow(snapshot);
      els.isbnInput.select();
    }
  }, 200);
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

window.addEventListener("load", loadHostedStock);

function riskExcludedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(RISK_EXCLUDED_KEY) || "[]"));
  } catch (error) {
    return new Set();
  }
}

function saveRiskExcludedSet(set) {
  localStorage.setItem(RISK_EXCLUDED_KEY, JSON.stringify([...set]));
}

function isRiskSelected(isbn) {
  return !riskExcludedSet().has(cleanCell(isbn));
}

function setRiskSelected(isbn, selected) {
  const cleanIsbn = cleanCell(isbn);
  if (!cleanIsbn) return;
  const excluded = riskExcludedSet();
  if (selected) {
    excluded.delete(cleanIsbn);
  } else {
    excluded.add(cleanIsbn);
    els.selectedRiskOnly.checked = true;
    localStorage.setItem(RISK_SELECTED_ONLY_KEY, "1");
  }
  saveRiskExcludedSet(excluded);
}
