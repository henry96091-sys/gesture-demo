import {
  GestureRecognizer,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const overlayCanvas = document.getElementById("overlayCanvas");
const ctx = overlayCanvas.getContext("2d");

let peer, conn, call, recognizer, stream;
let latestGesture = null;

/* 🔥 開相機（已修黑畫面） */
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = stream;

  /* 🔥 強制刷新畫面 */
  localVideo.onloadedmetadata = () => {
    localVideo.play();

    setInterval(() => {
      localVideo.style.transform = "scale(1)";
    }, 100);
  };

  setTimeout(() => {
    overlayCanvas.width = localVideo.videoWidth;
    overlayCanvas.height = localVideo.videoHeight;
  }, 500);

  initRecognizer();
  loop();
}

/* 手勢辨識 */
async function initRecognizer() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );

  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
    },
    runningMode: "VIDEO"
  });
}

/* 辨識循環 */
function loop() {
  const result = recognizer.recognizeForVideo(localVideo, performance.now());

  ctx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);

  if(result?.landmarks){
    result.landmarks.forEach(hand=>{
      hand.forEach(p=>{
        ctx.beginPath();
        ctx.arc(p.x*overlayCanvas.width,p.y*overlayCanvas.height,4,0,Math.PI*2);
        ctx.fill();
      });
    });
  }

  if(result?.gestures?.length){
    latestGesture = result.gestures[0][0].categoryName;
  }

  requestAnimationFrame(loop);
}

/* PeerJS */
function createPeer(){
  peer = new Peer();

  peer.on("open", id=>{
    document.getElementById("myId").value = id;
  });

  peer.on("connection", c=>{
    conn = c;
    conn.on("data", data=>{
      document.getElementById("remoteGestureText").innerText = data;
    });
  });

  peer.on("call", c=>{
    c.answer(stream);
    c.on("stream", s=>{
      remoteVideo.srcObject = s;
    });
  });
}

function connectPeer(){
  const id = document.getElementById("remoteId").value;

  conn = peer.connect(id);
  conn.on("open", ()=>{});

  call = peer.call(id, stream);
  call.on("stream", s=>{
    remoteVideo.srcObject = s;
  });
}

function sendGesture(){
  if(conn && latestGesture){
    conn.send(latestGesture);
  }
}

/* 綁按鈕 */
document.getElementById("createPeerBtn").onclick = createPeer;
document.getElementById("connectBtn").onclick = connectPeer;
document.getElementById("startCameraBtn").onclick = startCamera;
document.getElementById("sendGestureBtn").onclick = sendGesture;
