/*
 * Firebase 설정
 * ------------------------------------------------------------------
 * 여기에 Firebase 콘솔의 "웹 앱 설정(firebaseConfig)"을 붙여 넣으면
 * 폰↔진행 화면 연결이 Firebase Realtime Database 로 바뀝니다.
 * (이 값들은 웹앱에 원래 공개되는 값이라 비밀번호가 아닙니다. 보안은 DB 규칙으로 지킵니다.)
 *
 * 비워 두면(null) 예전 방식(무료 공개 서버: WebRTC + MQTT 중계)으로 동작합니다.
 *
 * 예)
 * window.TG_FIREBASE = {
 *   apiKey: "AIza....",
 *   authDomain: "my-party.firebaseapp.com",
 *   databaseURL: "https://my-party-default-rtdb.asia-southeast1.firebasedatabase.app",
 *   projectId: "my-party",
 *   appId: "1:1234:web:abcd"
 * };
 */
window.TG_FIREBASE = {
  apiKey: "AIzaSyAAcBDspi40ZFIn8msxKvCNnb2p9Is3DGU",
  authDomain: "songyear-960a0.firebaseapp.com",
  databaseURL: "https://songyear-960a0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "songyear-960a0",
  storageBucket: "songyear-960a0.firebasestorage.app",
  messagingSenderId: "555471730485",
  appId: "1:555471730485:web:37b446488a0c5a2237fe7c"
};
