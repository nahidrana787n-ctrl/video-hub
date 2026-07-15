/* ============ গ্লোবাল অথ স্টেট ============ */
let currentUser = null;
let currentUserData = null;
let pendingAfterLogin = null; // login এর পর যে কাজটি চালাতে হবে

auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  if (user) {
    try {
      const snap = await db.collection('users').doc(user.uid).get();
      currentUserData = snap.exists ? snap.data() : null;
    } catch (e) { console.error(e); }
  } else {
    currentUserData = null;
  }
  document.dispatchEvent(new CustomEvent('authReady', { detail: { user, data: currentUserData } }));
  refreshAuthUI();
  if (user && typeof pendingAfterLogin === 'function') {
    const fn = pendingAfterLogin;
    pendingAfterLogin = null;
    closeAuthModal();
    fn();
  }
});

function avatarHTML(size) {
  const url = currentUserData?.photoURL || currentUser?.photoURL;
  const initial = (currentUserData?.displayName || currentUser?.email || '?').trim()[0]?.toUpperCase() || '?';
  if (url) return `<img src="${escapeHtml(url)}" alt="">`;
  return `<span style="font-weight:800;font-family:'Baloo Da 2'">${initial}</span>`;
}

function refreshAuthUI() {
  document.querySelectorAll('[data-auth="loggedin"]').forEach(el => {
    el.style.display = currentUser ? '' : 'none';
  });
  document.querySelectorAll('[data-auth="loggedout"]').forEach(el => {
    el.style.display = currentUser ? 'none' : '';
  });
  const nameEls = document.querySelectorAll('.js-username');
  nameEls.forEach(el => el.textContent = currentUserData?.displayName || currentUser?.email || 'ইউজার');
  document.querySelectorAll('.js-avatar').forEach(el => { el.innerHTML = avatarHTML(); });
  document.querySelectorAll('.js-avatar-img').forEach(el => {
    const url = currentUserData?.photoURL || currentUser?.photoURL;
    if (url) { el.src = url; el.style.display = ''; }
    else { el.style.display = 'none'; }
  });
  const initialEls = document.querySelectorAll('.js-initial');
  const initial = (currentUserData?.displayName || currentUser?.email || '?').trim()[0]?.toUpperCase() || '?';
  initialEls.forEach(el => { if (!el.classList.contains('js-avatar')) el.textContent = initial; });
}

/* ============ মোডাল ওপেন/ক্লোজ ============ */
function openAuthModal(mode = 'login', after = null) {
  pendingAfterLogin = after;
  const overlay = document.getElementById('authModal');
  if (!overlay) return;
  overlay.classList.add('open');
  switchAuthMode(mode);
  document.getElementById('authError').classList.remove('show');
}
function closeAuthModal() {
  const overlay = document.getElementById('authModal');
  if (overlay) overlay.classList.remove('open');
}
function switchAuthMode(mode) {
  const isLogin = mode === 'login';
  document.getElementById('loginForm').style.display = isLogin ? 'block' : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none' : 'block';
  document.querySelectorAll('.auth-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  document.getElementById('authError').classList.remove('show');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

function friendlyAuthError(code) {
  const map = {
    'auth/email-already-in-use': 'এই ইমেইল দিয়ে আগে থেকেই অ্যাকাউন্ট আছে',
    'auth/invalid-email': 'সঠিক ইমেইল দিন',
    'auth/weak-password': 'পাসওয়ার্ড কমপক্ষে ৬ ক্যারেক্টার হতে হবে',
    'auth/user-not-found': 'এই তথ্য দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি',
    'auth/wrong-password': 'পাসওয়ার্ড সঠিক নয়',
    'auth/invalid-credential': 'তথ্য অথবা পাসওয়ার্ড সঠিক নয়',
    'auth/too-many-requests': 'অনেকবার চেষ্টা হয়েছে, একটু পরে চেষ্টা করুন',
  };
  return map[code] || 'কিছু একটা সমস্যা হয়েছে, আবার চেষ্টা করুন';
}

function normalizeUsername(u) {
  return (u || '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
}

/* ============ লগইন (ইমেইল অথবা ইউজারনেম দিয়ে) ============ */
async function handleLogin(e) {
  e.preventDefault();
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    let email = identifier;
    if (!identifier.includes('@')) {
      const uname = normalizeUsername(identifier);
      const snap = await db.collection('users').where('username', '==', uname).limit(1).get();
      if (snap.empty) throw { code: 'auth/user-not-found' };
      email = snap.docs[0].data().email;
    }
    await auth.signInWithEmailAndPassword(email, pass);

    /* লগইন সফল — একই কারণে (pendingAfterLogin না থাকলে onAuthStateChanged মোডাল বন্ধ করে না)
       এখানেই সরাসরি মোডাল বন্ধ করা হচ্ছে। */
    e.target.reset();
    closeAuthModal();
    if (typeof pendingAfterLogin === 'function') {
      const fn = pendingAfterLogin;
      pendingAfterLogin = null;
      fn();
    }
  } catch (err) {
    showAuthError(friendlyAuthError(err.code));
  } finally {
    btn.disabled = false; btn.textContent = 'লগইন করুন';
  }
}

/* ============ রেজিস্ট্রেশন (নাম + ইউজারনেম + ফোন/ইমেইল) ============ */
async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const usernameRaw = document.getElementById('regUsername').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPassword').value;
  const btn = document.getElementById('registerBtn');

  if (!name) { showAuthError('আপনার নাম লিখুন'); return; }
  const username = normalizeUsername(usernameRaw);
  if (!username || username.length < 3) { showAuthError('সঠিক ইউজারনেম দিন (কমপক্ষে ৩ অক্ষর, শুধু a-z 0-9 _ .)'); return; }
  if (!email) { showAuthError('জিমেইল/ইমেইল দিন — লগইনের জন্য প্রয়োজন'); return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const existing = await db.collection('users').where('username', '==', username).limit(1).get();
    if (!existing.empty) throw { code: 'auth/username-taken' };

    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      displayName: name,
      username,
      phone: phone || '',
      email: email,
      photoURL: '',
      isAdmin: isAdminEmail(email),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    currentUserData = { displayName: name, username, phone, email, photoURL: '', isAdmin: isAdminEmail(email) };

    /* রেজিস্ট্রেশন সফল — এখানেই মোডাল বন্ধ করে UI রিফ্রেশ করা হচ্ছে,
       কারণ onAuthStateChanged শুধুমাত্র pendingAfterLogin সেট থাকলে মোডাল বন্ধ করে —
       আর সরাসরি "রেজিস্ট্রেশন" বাটনে ক্লিক করলে pendingAfterLogin খালি থাকে,
       তাই আগে মোডাল বন্ধ না হয়ে আটকে থাকতো। */
    refreshAuthUI();
    e.target.reset();
    closeAuthModal();
    showToast(`স্বাগতম, ${name}! অ্যাকাউন্ট তৈরি হয়েছে ✅`);
    if (typeof pendingAfterLogin === 'function') {
      const fn = pendingAfterLogin;
      pendingAfterLogin = null;
      fn();
    }
  } catch (err) {
    if (err.code === 'auth/username-taken') showAuthError('এই ইউজারনেম আগে থেকেই ব্যবহৃত হচ্ছে, অন্য একটি দিন');
    else showAuthError(friendlyAuthError(err.code));
  } finally {
    btn.disabled = false; btn.textContent = 'অ্যাকাউন্ট খুলুন';
  }
}

function handleLogout() {
  auth.signOut().then(() => {
    showToast('লগআউট হয়েছে');
    setTimeout(() => { window.location.href = 'index.html'; }, 500);
  });
}

/* কোনো একশনের আগে লগইন যাচাই — লগইন না থাকলে মোডাল খুলে দেয় */
function requireAuth(action) {
  if (currentUser) { action(); }
  else { openAuthModal('login', action); }
}

/* ============ প্রোফাইল পিকচার আপলোড ============ */
async function uploadAvatar(file) {
  if (!currentUser) return;
  if (!IMGBB_API_KEY || IMGBB_API_KEY === 'YOUR_IMGBB_API_KEY') {
    showToast('imgbb API key সেট করা হয়নি');
    return;
  }
  try {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) throw new Error('আপলোড ব্যর্থ');
    const url = data.data.url;
    await currentUser.updateProfile({ photoURL: url });
    await db.collection('users').doc(currentUser.uid).update({ photoURL: url });
    currentUserData = { ...(currentUserData || {}), photoURL: url };
    refreshAuthUI();
    document.dispatchEvent(new CustomEvent('avatarUpdated', { detail: { url } }));
    showToast('প্রোফাইল ছবি আপডেট হয়েছে ✅');
  } catch (err) {
    console.error(err);
    showToast('প্রোফাইল ছবি আপলোড করতে সমস্যা হয়েছে');
  }
}

/* ============ টোস্ট ============ */
function showToast(msg) {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2200);
}
