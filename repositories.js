import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence, getAuth, GoogleAuthProvider,
  onAuthStateChanged, setPersistence, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteToken, getMessaging, getToken, isSupported as isMessagingSupported, onMessage
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js";
import { firebaseConfig } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const provider = new GoogleAuthProvider();
let messagingInstance = null;
provider.setCustomParameters({ prompt: "select_account" });

export const authRepository = {
  async initialize() {
    await setPersistence(auth, browserLocalPersistence);
  },
  subscribeAuthState(callback) {
    return onAuthStateChanged(auth, callback);
  },
  signIn() {
    return signInWithPopup(auth, provider);
  },
  signOut() {
    return signOut(auth);
  }
};

export const accessRepository = {
  async getAllowedUser(uid) {
    const snapshot = await getDoc(doc(db, "allowedUsers", uid));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  },
  async isAllowed(uid) {
    const user = await this.getAllowedUser(uid);
    return Boolean(user?.active);
  }
};

export const eventRepository = {
  add(event) {
    return addDoc(collection(db, "events"), {
      ...event,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  },
  update(id, changes) {
    return updateDoc(doc(db, "events", id), { ...changes, updatedAt: serverTimestamp() });
  },
  remove(id) {
    return deleteDoc(doc(db, "events", id));
  },
  async getAll() {
    const snapshot = await getDocs(query(collection(db, "events"), orderBy("createdAt", "desc")));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  },
  subscribe(callback, onError) {
    const eventsQuery = query(collection(db, "events"), orderBy("createdAt", "desc"));
    return onSnapshot(eventsQuery, snapshot => {
      callback(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
    }, onError);
  },
  async migrationCompleted(uid) {
    return (await getDoc(doc(db, "migrations", uid))).exists();
  },
  async migrate(events, uid) {
    for (let offset = 0; offset < events.length; offset += 400) {
      const batch = writeBatch(db);
      events.slice(offset, offset + 400).forEach(event => {
        const safeId=String(event.migrationSourceId).replace(/[^a-zA-Z0-9_-]/g, "_");
        const target=doc(db, "events", `legacy_${uid}_${safeId}`);
        batch.set(target, {
          ...event,
          migrationOwnerUid: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: false });
      });
      await batch.commit();
    }
  },
  completeMigration(uid, eventCount) {
    return setDoc(doc(db, "migrations", uid), {
      ownerUid: uid,
      eventCount,
      completedAt: serverTimestamp()
    });
  }
};

export const settingsRepository = {
  subscribe(callback, onError) {
    return onSnapshot(doc(db, "settings", "default"), snapshot => {
      callback(snapshot.exists() ? snapshot.data() : { householdName: "我が家", quickItems: [] });
    }, onError);
  },
  async update(changes) {
    return setDoc(doc(db, "settings", "default"), {
      householdName: "我が家",
      ...changes,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
};


async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export const notificationRepository = {
  isConfigured() {
    return Boolean(firebaseConfig.vapidKey && !firebaseConfig.vapidKey.startsWith("REPLACE_"));
  },
  async isSupported() {
    return "Notification" in window && "serviceWorker" in navigator && await isMessagingSupported();
  },
  async enable(uid) {
    if (!this.isConfigured()) throw new Error("VAPID公開鍵が設定されていません");
    if (!(await this.isSupported())) throw new Error("このブラウザはプッシュ通知に対応していません");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("通知が許可されませんでした");
    const serviceWorkerRegistration = await navigator.serviceWorker.ready;
    messagingInstance ||= getMessaging(firebaseApp);
    const token = await getToken(messagingInstance, {
      vapidKey: firebaseConfig.vapidKey,
      serviceWorkerRegistration
    });
    if (!token) throw new Error("通知トークンを取得できませんでした");
    const tokenId = await sha256(token);
    await setDoc(doc(db, "notificationTokens", uid, "tokens", tokenId), {
      uid,
      token,
      active: true,
      userAgent: navigator.userAgent,
      platform: navigator.platform || "",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge: true });
    localStorage.setItem("uchilog_fcm_token_id", tokenId);
    return token;
  },
  async disable(uid) {
    if (!(await this.isSupported())) return;
    messagingInstance ||= getMessaging(firebaseApp);
    const tokenId = localStorage.getItem("uchilog_fcm_token_id");
    if (tokenId) await deleteDoc(doc(db, "notificationTokens", uid, "tokens", tokenId));
    await deleteToken(messagingInstance).catch(() => false);
    localStorage.removeItem("uchilog_fcm_token_id");
  },
  subscribeForeground(callback) {
    if (!messagingInstance) messagingInstance = getMessaging(firebaseApp);
    return onMessage(messagingInstance, callback);
  }
};
