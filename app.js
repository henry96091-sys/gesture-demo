import {
  GestureRecognizer,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const myPeerIdInput = document.getElementById("myPeerId");
const remotePeerIdInput = document.getElementById("remotePeerId");
const copyMyIdBtn = document.getElementById("copyMyIdBtn");
const connectBtn = document.getElementById("connectBtn");
const connStatus = document.getElementById("connStatus");
const remoteGesture = document.getElementById("remoteGesture");
const localGesture = document.getElementById("localGesture");
const gestureScore = document.getElementById("gestureScore");
const handedness = document.getElementById("handedness");
const startCameraBtn = document.getElementById("startCameraBtn");
const sendNowBtn = document.getElementById("sendNowBtn");
const logBox = document.getElementById("logBox");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const remotePanel = document.getElementById("remotePanel");
const remoteBig = document.getElementById("remoteBig");

let peer = null;
let conn = null;
let localStream = null;
let gestureRecognizer = null;
let animationId = null;
let lastSentGestureName = "";
let latestGesturePayload = null;
let cooldown = false;

function log(msg) {
  const time = new Date().toLocaleTimeString();
  logBox.textContent += `[${time}] ${msg}\n`;
  logBox.scrollTop = logBox.scrollHeight;
  console.log(msg);
}

function setStatus(text) {
  connStatus.textContent = text;
}

function initPeer() {
  peer = new Peer();

  peer.on("open", (id) => {
    myPeerIdInput.value = id;
    log("Peer 已啟動，ID：" + id);
  });

  peer.on("connection", (incomingConn) => {
    setupConnection(incomingConn, "收到對方連線");
  });

  peer.on("error", (err) => {
    log("Peer 錯誤：" + err);
    setStatus("連線錯誤");
  });
}

function setupConnection(newConn, sourceText = "已建立連線") {
  conn = newConn;

  conn.on("open", () => {
    setStatus("已連線");
    log(sourceText);
  });

  conn.on("data", (data) => {
    log("收到資料：" + JSON.stringify(data));
    if (data?.type === "gesture") {
      showRemoteGesture(data);
    }
  });

  conn.on("close", () => {
    setStatus("已斷線");
    log("資料通道已關閉");
  });

  conn.on("error", (err) => {
    log("資料通道錯誤：" + err);
    setStatus("資料通道錯誤");
  });
}

function connectToPeer() {
  const remoteId = remotePeerIdInput.value.trim();
  if (!remoteId) {
    alert("請先貼上對方的 Peer ID");
    return;
  }
  const outgoingConn = peer.connect(remoteId);
  setupConnection(outgoingConn, "主動連線成功");
  setStatus("連線中");
}

async function initGestureRecognizer() {
  if (gestureRecognizer) return gestureRecognizer;

  log("載入 MediaPipe 模型中...");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );

  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
    },
    runningMode: "VIDEO",
    numHands: 2
  });

  log("MediaPipe 已就緒");
  return gestureRecognizer;
}

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });
    video.srcObject = localStream;
    await video.play();
    overlay.width = video.videoWidth || 1280;
    overlay.height = video.videoHeight || 720;
    await initGestureRecognizer();
    startLoop();
    log("相機已開啟");
  } catch (error) {
    log("相機開啟失敗：" + error.message);
    alert("無法開啟相機，請確認權限已允許。");
  }
}

function drawLandmarks(result) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!result?.landmarks?.length) return;

  overlayCtx.fillStyle = "#38bdf8";
  result.landmarks.forEach((hand) => {
    hand.forEach((p) => {
      overlayCtx.beginPath();
      overlayCtx.arc(p.x * overlay.width, p.y * overlay.height, 4, 0, Math.PI * 2);
      overlayCtx.fill();
    });
  });
}

function parseGesture(result) {
  const g = result?.gestures?.[0]?.[0];
  const h = result?.handednesses?.[0]?.[0];
  if (!g) {
    localGesture.textContent = "尚未辨識";
    gestureScore.textContent = "-";
    handedness.textContent = "-";
    latestGesturePayload = null;
    return;
  }

  const payload = {
    type: "gesture",
    name: g.categoryName || "未知手勢",
    score: typeof g.score === "number" ? g.score.toFixed(2) : "-",
    handedness: h?.categoryName || "-"
  };

  localGesture.textContent = payload.name;
  gestureScore.textContent = payload.score;
  handedness.textContent = payload.handedness;
  latestGesturePayload = payload;
}

function sendGesture(payload, force = false) {
  if (!conn || !payload || !conn.open) return;
  if (!force && (payload.name === lastSentGestureName || cooldown)) return;

  try {
    conn.send(payload);
    lastSentGestureName = payload.name;
    cooldown = true;
    setTimeout(() => (cooldown = false), 600);
    log("送出手勢：" + payload.name);
  } catch (error) {
    log("送出失敗：" + error.message);
  }
}

function startLoop() {
  if (animationId) cancelAnimationFrame(animationId);

  const loop = () => {
    if (
      gestureRecognizer &&
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0
    ) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      const result = gestureRecognizer.recognizeForVideo(video, performance.now());
      drawLandmarks(result);
      parseGesture(result);
      sendGesture(latestGesturePayload);
    }
    animationId = requestAnimationFrame(loop);
  };

  animationId = requestAnimationFrame(loop);
}

function showRemoteGesture(payload) {
  remoteGesture.textContent = `${payload.name} / ${payload.score} / ${payload.handedness}`;
  remoteBig.textContent = payload.name;

  let bg = "#e5e7eb";
  let color = "#111827";

  if (payload.name === "Thumb_Up") {
    bg = "#dcfce7";
    color = "#166534";
  } else if (payload.name === "Victory") {
    bg = "#dbeafe";
    color = "#1d4ed8";
  } else if (payload.name === "Open_Palm") {
    bg = "#ffedd5";
    color = "#c2410c";
  }

  remotePanel.style.background = bg;
  remotePanel.style.color = color;
}

copyMyIdBtn.addEventListener("click", async () => {
  if (!myPeerIdInput.value) return;
  await navigator.clipboard.writeText(myPeerIdInput.value);
  log("已複製自己的 Peer ID");
});

connectBtn.addEventListener("click", connectToPeer);
startCameraBtn.addEventListener("click", startCamera);
sendNowBtn.addEventListener("click", () => sendGesture(latestGesturePayload, true));

initPeer();
