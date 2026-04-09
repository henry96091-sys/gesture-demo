import {
  GestureRecognizer,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const myId = document.getElementById("myId");
const remoteId = document.getElementById("remoteId");
const createPeerBtn = document.getElementById("createPeerBtn");
const connectBtn = document.getElementById("connectBtn");
const startCameraBtn = document.getElementById("startCameraBtn");
const sendGestureBtn = document.getElementById("sendGestureBtn");

const peerStatus = document.getElementById("peerStatus");
const dataStatus = document.getElementById("dataStatus");
const mediaStatus = document.getElementById("mediaStatus");

const gestureNow = document.getElementById("gestureNow");
const handednessNow = document.getElementById("handednessNow");
const scoreNow = document.getElementById("scoreNow");
const remoteGestureText = document.getElementById("remoteGestureText");

const logEl = document.getElementById("log");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const overlayCanvas = document.getElementById("overlayCanvas");
const ctx = overlayCanvas.getContext("2d");

let peer = null;
let dataConn = null;
let mediaCall = null;
let recognizer = null;
let localStream = null;
let latestGesture = null;
let loopId = null;

function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

async function initRecognizer() {
  if (recognizer) return recognizer;
  log("載入 MediaPipe...");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
    },
    runningMode: "VIDEO",
    numHands: 2
  });
  log("MediaPipe 載入完成");
  return recognizer;
}

function drawLandmarks(result) {
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!result?.landmarks?.length) return;
  ctx.fillStyle = "#38bdf8";
  result.landmarks.forEach(hand => {
    hand.forEach(point => {
      const x = point.x * overlayCanvas.width;
      const y = point.y * overlayCanvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function parseResult(result) {
  const gesture = result?.gestures?.[0]?.[0];
  const handed = result?.handednesses?.[0]?.[0];

  if (!gesture) {
    gestureNow.textContent = "尚未辨識";
    handednessNow.textContent = "-";
    scoreNow.textContent = "-";
    latestGesture = null;
    return;
  }

  latestGesture = {
    name: gesture.categoryName || "未知手勢",
    score: Number(gesture.score || 0).toFixed(2),
    handedness: handed?.categoryName || "-",
    ts: Date.now()
  };

  gestureNow.textContent = latestGesture.name;
  handednessNow.textContent = latestGesture.handedness;
  scoreNow.textContent = latestGesture.score;
}

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
    await localVideo.play();

    overlayCanvas.width = localVideo.videoWidth || 1280;
    overlayCanvas.height = localVideo.videoHeight || 720;

    await initRecognizer();
    startLoop();
    log("相機與麥克風已開啟");
  } catch (e) {
    log("開啟相機失敗：" + e.message);
    alert("開啟相機失敗，請確認你是用 HTTPS 網址，並允許相機 / 麥克風權限。");
  }
}

function startLoop() {
  if (loopId) cancelAnimationFrame(loopId);

  const run = () => {
    if (recognizer && localVideo.readyState >= 2) {
      overlayCanvas.width = localVideo.videoWidth || overlayCanvas.width;
      overlayCanvas.height = localVideo.videoHeight || overlayCanvas.height;

      const result = recognizer.recognizeForVideo(localVideo, performance.now());
      drawLandmarks(result);
      parseResult(result);
    }
    loopId = requestAnimationFrame(run);
  };

  loopId = requestAnimationFrame(run);
}

function attachDataConnection(conn) {
  dataConn = conn;
  dataStatus.textContent = "已連線";
  log("資料通道已連線：" + conn.peer);

  conn.on("data", data => {
    log("收到資料：" + JSON.stringify(data));
    if (data.type === "gesture") {
      remoteGestureText.textContent = `${data.name}（${data.handedness} 手，${data.score}）`;
    }
  });

  conn.on("close", () => {
    dataStatus.textContent = "已中斷";
    log("資料通道已中斷");
  });

  conn.on("error", err => {
    log("資料通道錯誤：" + err.message);
  });
}

function attachMediaCall(call) {
  mediaCall = call;
  mediaStatus.textContent = "連線中";
  log("收到 / 建立視訊通話：" + call.peer);

  call.on("stream", remoteStream => {
    remoteVideo.srcObject = remoteStream;
    mediaStatus.textContent = "已連線";
    log("已收到遠端影像");
  });

  call.on("close", () => {
    mediaStatus.textContent = "已中斷";
    log("視訊通話已中斷");
  });

  call.on("error", err => {
    mediaStatus.textContent = "錯誤";
    log("視訊通話錯誤：" + err.message);
  });
}

function createPeer() {
  if (peer) {
    log("Peer 已建立，不需重複建立");
    return;
  }

  peer = new Peer();

  peer.on("open", id => {
    myId.value = id;
    peerStatus.textContent = "已建立";
    log("我的 Peer ID：" + id);
  });

  peer.on("connection", conn => {
    log("收到資料連線請求：" + conn.peer);
    attachDataConnection(conn);
  });

  peer.on("call", call => {
    if (!localStream) {
      alert("請先按『開啟相機』再接聽");
      log("尚未開啟相機，無法接聽視訊");
      return;
    }
    call.answer(localStream);
    attachMediaCall(call);
  });

  peer.on("error", err => {
    peerStatus.textContent = "錯誤";
    log("Peer 錯誤：" + err.message);
  });

  peer.on("disconnected", () => {
    peerStatus.textContent = "已中斷";
    log("Peer 已中斷");
  });
}

function connectPeer() {
  if (!peer) {
    alert("請先按『建立我的 ID』");
    return;
  }
  if (!localStream) {
    alert("請先按『開啟相機』");
    return;
  }

  const target = remoteId.value.trim();
  if (!target) {
    alert("請輸入對方 ID");
    return;
  }

  const conn = peer.connect(target, { reliable: true });
  conn.on("open", () => attachDataConnection(conn));
  conn.on("error", err => log("資料連線失敗：" + err.message));

  const call = peer.call(target, localStream);
  attachMediaCall(call);
}

function sendGesture() {
  if (!dataConn || !dataConn.open) {
    alert("尚未和對方建立資料連線");
    return;
  }
  if (!latestGesture) {
    alert("目前還沒有辨識到手勢");
    return;
  }

  dataConn.send({
    type: "gesture",
    ...latestGesture
  });

  log("已送出手勢：" + latestGesture.name);
}

createPeerBtn.addEventListener("click", createPeer);
connectBtn.addEventListener("click", connectPeer);
startCameraBtn.addEventListener("click", startCamera);
sendGestureBtn.addEventListener("click", sendGesture);

remoteId.addEventListener("keydown", e => {
  if (e.key === "Enter") connectPeer();
});
