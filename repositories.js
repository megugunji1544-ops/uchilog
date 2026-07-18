import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence, getAuth, GoogleAuthProvider,
  onAuthStateChanged, setPersistence, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const provider = new GoogleAuthProvider();
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
