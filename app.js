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
}

async function initRecognizer() {
  if (recognizer) return recognizer;

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
    latestGesture = null;
    return;
  }

  latestGesture = {
    name: gesture.categoryName,
    score: gesture.score.toFixed(2),
    handedness: handed?.categoryName || "-"
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

    localVideo.onloadedmetadata = () => {
      localVideo.play();

      setTimeout(() => {
        overlayCanvas.width = localVideo.videoWidth;
        overlayCanvas.height = localVideo.videoHeight;
      }, 500);
    };

    await initRecognizer();
    startLoop();

  } catch (e) {
    alert("相機開啟失敗（請確認 HTTPS + 權限）");
  }
}

function startLoop() {
  if (loopId) cancelAnimationFrame(loopId);

  const run = () => {
    if (recognizer && localVideo.readyState >= 2) {
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

  conn.on("data", data => {
    if (data.type === "gesture") {
      remoteGestureText.textContent = data.name;
    }
  });
}

function attachMediaCall(call) {
  mediaCall = call;

  call.on("stream", remoteStream => {
    remoteVideo.srcObject = remoteStream;
    mediaStatus.textContent = "已連線";
  });
}

function createPeer() {
  peer = new Peer();

  peer.on("open", id => {
    myId.value = id;
    peerStatus.textContent = "已建立";
  });

  peer.on("connection", conn => {
    attachDataConnection(conn);
  });

  peer.on("call", call => {
    call.answer(localStream);
    attachMediaCall(call);
  });
}

function connectPeer() {
  const target = remoteId.value;

  const conn = peer.connect(target);
  conn.on("open", () => attachDataConnection(conn));

  const call = peer.call(target, localStream);
  attachMediaCall(call);
}

function sendGesture() {
  if (!dataConn || !latestGesture) return;

  dataConn.send({
    type: "gesture",
    ...latestGesture
  });
}

createPeerBtn.onclick = createPeer;
connectBtn.onclick = connectPeer;
startCameraBtn.onclick = startCamera;
sendGestureBtn.onclick = sendGesture;
