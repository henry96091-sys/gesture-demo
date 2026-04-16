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
let lastVideoTime = -1;

// 防抖：連續幾幀一樣才更新
let recentCounts = [];

function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

async function initRecognizer() {
  if (recognizer) return recognizer;

  log("載入手勢模型中...");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );

  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
    },
    runningMode: "VIDEO",
    numHands: 1
  });

  log("手勢模型已載入");
  return recognizer;
}

function drawLandmarks(result) {
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!result?.landmarks?.length) return;

  ctx.fillStyle = "#38bdf8";

  result.landmarks.forEach((hand) => {
    hand.forEach((p) => {
      ctx.beginPath();
      ctx.arc(
        p.x * overlayCanvas.width,
        p.y * overlayCanvas.height,
        4,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
  });
}

function getDisplayHandedness(rawHandedness) {
  let handedness = rawHandedness || "-";

  // 因本機畫面鏡像顯示，左右反轉較符合直覺
  if (handedness === "Left") handedness = "Right";
  else if (handedness === "Right") handedness = "Left";

  return handedness;
}

// 四指：用 tip / dip / pip 三層關係判斷，比只看一層穩
function isFingerUp(landmarks, tip, dip, pip) {
  return (
    landmarks[tip].y < landmarks[dip].y &&
    landmarks[dip].y < landmarks[pip].y
  );
}

// 拇指：依左右手用 x 方向判斷，但加一點距離閾值避免亂跳
function isThumbUp(landmarks, rawHandedness) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const threshold = 0.02;

  if (rawHandedness === "Right") {
    return thumbTip.x < thumbIp.x - threshold;
  }
  if (rawHandedness === "Left") {
    return thumbTip.x > thumbIp.x + threshold;
  }

  return false;
}

function countFingers(landmarks, rawHandedness) {
  let count = 0;

  if (isThumbUp(landmarks, rawHandedness)) count++;

  if (isFingerUp(landmarks, 8, 7, 6)) count++;    // 食指
  if (isFingerUp(landmarks, 12, 11, 10)) count++; // 中指
  if (isFingerUp(landmarks, 16, 15, 14)) count++; // 無名指
  if (isFingerUp(landmarks, 20, 19, 18)) count++; // 小指

  return count;
}

function getStableCount(newCount) {
  recentCounts.push(newCount);
  if (recentCounts.length > 5) recentCounts.shift();

  const freq = {};
  for (const c of recentCounts) {
    freq[c] = (freq[c] || 0) + 1;
  }

  let best = newCount;
  let bestFreq = 0;

  for (const key in freq) {
    if (freq[key] > bestFreq) {
      bestFreq = freq[key];
      best = Number(key);
    }
  }

  return best;
}

function parseResult(result) {
  const gesture = result?.gestures?.[0]?.[0];
  const rawHanded = result?.handednesses?.[0]?.[0]?.categoryName || "-";
  const displayHandedness = getDisplayHandedness(rawHanded);
  const landmarks = result?.landmarks?.[0];

  if (!landmarks) {
    gestureNow.textContent = "尚未辨識";
    handednessNow.textContent = "-";
    scoreNow.textContent = "-";
    latestGesture = null;
    return;
  }

  const counted = countFingers(landmarks, rawHanded);
  const stableCount = getStableCount(counted);

  const confidence = gesture?.score != null
    ? Number(gesture.score).toFixed(2)
    : "-";

  latestGesture = {
    name: "Finger_Count",
    display: stableCount.toString(),
    score: confidence,
    handedness: displayHandedness
  };

  gestureNow.textContent = latestGesture.display;
  handednessNow.textContent = latestGesture.handedness;
  scoreNow.textContent = latestGesture.score;
}

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        facingMode: "user"
      },
      audio: false
    });

    localVideo.srcObject = localStream;

    await new Promise((resolve) => {
      localVideo.onloadedmetadata = async () => {
        await localVideo.play();
        resolve();
      };
    });

    overlayCanvas.width = localVideo.videoWidth || 640;
    overlayCanvas.height = localVideo.videoHeight || 360;

    await initRecognizer();
    startLoop();

    log("相機已開啟");
  } catch (e) {
    log("開啟相機失敗：" + e.message);
    alert("相機開啟失敗，請確認 HTTPS 與相機權限。");
  }
}

function startLoop() {
  if (loopId) cancelAnimationFrame(loopId);

  const run = () => {
    try {
      if (
        recognizer &&
        localVideo.readyState >= 2 &&
        localVideo.videoWidth > 0 &&
        localVideo.videoHeight > 0
      ) {
        if (localVideo.currentTime !== lastVideoTime) {
          lastVideoTime = localVideo.currentTime;

          if (
            overlayCanvas.width !== localVideo.videoWidth ||
            overlayCanvas.height !== localVideo.videoHeight
          ) {
            overlayCanvas.width = localVideo.videoWidth;
            overlayCanvas.height = localVideo.videoHeight;
          }

          const result = recognizer.recognizeForVideo(
            localVideo,
            performance.now()
          );

          drawLandmarks(result);
          parseResult(result);
        }
      }
    } catch (err) {
      log("辨識錯誤：" + err.message);
    }

    loopId = requestAnimationFrame(run);
  };

  loopId = requestAnimationFrame(run);
}

function setupDataConn(conn) {
  dataConn = conn;
  log("資料連線成功：" + conn.peer);

  conn.on("open", () => {
    log("資料通道 open：" + conn.peer);
  });

  conn.on("data", (data) => {
    if (data.type === "gesture") {
      remoteGestureText.textContent =
        `${data.display || data.name}（${data.handedness} 手，${data.score}）`;
    }
  });

  conn.on("close", () => {
    log("資料通道已關閉");
  });

  conn.on("error", (err) => {
    log("資料通道錯誤：" + err.message);
  });
}

function setupMediaCall(call) {
  mediaCall = call;
  log("視訊連線建立：" + call.peer);

  call.on("stream", (remoteStream) => {
    log("收到遠端視訊流");
    remoteVideo.srcObject = remoteStream;
  });

  call.on("close", () => {
    log("視訊通話已關閉");
  });

  call.on("error", (err) => {
    log("視訊通話錯誤：" + err.message);
  });
}

function createPeer() {
  if (peer) {
    log("Peer 已存在，不重建");
    return;
  }

  peer = new Peer({
    debug: 2
  });

  peer.on("open", (id) => {
    myId.value = id;
    log("我的 Peer ID：" + id);
  });

  peer.on("connection", (conn) => {
    log("收到資料連線請求：" + conn.peer);
    setupDataConn(conn);
  });

  peer.on("call", (call) => {
    log("收到視訊通話請求：" + call.peer);

    if (!localStream) {
      log("尚未開相機，無法接聽");
      return;
    }

    call.answer(localStream);
    setupMediaCall(call);
  });

  peer.on("error", (err) => {
    log("Peer 錯誤：" + (err.message || err.type || "未知錯誤"));
  });

  peer.on("disconnected", () => {
    log("Peer 已斷線");
  });

  peer.on("close", () => {
    log("Peer 已關閉");
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

  if (target === myId.value.trim()) {
    alert("不能連自己");
    return;
  }

  log("開始連線到：" + target);

  const conn = peer.connect(target, {
    reliable: true
  });

  conn.on("open", () => {
    log("主動發起的資料通道已開啟：" + target);
    setupDataConn(conn);
  });

  conn.on("error", (err) => {
    log("主動連線失敗：" + err.message);
  });

  const call = peer.call(target, localStream);
  setupMediaCall(call);
}

function sendGesture() {
  if (!dataConn || !dataConn.open) {
    alert("尚未建立資料連線");
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

  log("送出數字：" + latestGesture.display);
}

createPeerBtn.addEventListener("click", createPeer);
connectBtn.addEventListener("click", connectPeer);
startCameraBtn.addEventListener("click", startCamera);
sendGestureBtn.addEventListener("click", sendGesture);
