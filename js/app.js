/* ============ ইউটিলিটি ============ */
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
function timeAgo(ts) {
  if (!ts) return 'এইমাত্র';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'এইমাত্র';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + ' মিনিট আগে';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' ঘণ্টা আগে';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + ' দিন আগে';
  const mo = Math.floor(day / 30);
  if (mo < 12) return mo + ' মাস আগে';
  return Math.floor(mo / 12) + ' বছর আগে';
}
function formatCount(n) {
  n = n || 0;
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}
function setActiveNav(page) {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}
const ICONS = {
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>`,
  fire: `🔥`
};

/* ============ ক্যাটাগরি তালিকা ============ */
const CATEGORY_LIST = [
  { id: 'all', label: 'সব' },
  { id: 'natural', label: 'বাংলা ভিডিও' },
  { id: 'travel', label: 'ভাইরাল ভিডিও' },
  { id: 'entertainment', label: 'গার্লফ্রেন্ড নুড' },
  { id: 'education', label: 'গোসল ভিডিও' },
  { id: 'funny', label: 'আম্মু ভিডিও' },
  { id: 'other', label: 'spy video' },
];

/* ============ কার্ড রেন্ডার ============ */
function isLikedByMe(item) {
  return !!(currentUser && item.likedBy && item.likedBy[currentUser.uid]);
}
function mediaCardHTML(item) {
  const isVideo = item.type === 'video';
  const target = isVideo ? `watch.html?id=${item.id}` : `photo.html?id=${item.id}`;
  const liked = isLikedByMe(item);
  return `
    <a class="card" href="${target}" style="animation-delay:${Math.random()*.2}s">
      <div class="thumb-wrap">
        ${thumbMediaHTML(item)}
        <span class="badge ${isVideo ? 'video' : 'photo'}">${isVideo ? 'ভিডিও' : 'ফটো'}</span>
        <span class="badge views">${ICONS.eye.replace('<svg ', '<svg width="11" height="11" ')}${formatCount(item.views||0)}</span>
        <div class="play-glyph"><div class="circ">${isVideo ? '<div class="tri"></div>' : ICONS.eye.replace('<svg ', '<svg width="18" height="18" stroke="#fff" ')}</div></div>
        <div class="card-overlay-body">
          <div class="card-title">${escapeHtml(item.caption || 'শিরোনামহীন')}</div>
          <div class="card-meta">
            <span>${escapeHtml(item.uploaderName || 'ইউজার')}</span>
            <span class="dot"></span>
            <span>${timeAgo(item.createdAt)}</span>
          </div>
          <div class="card-actions">
            <button class="mini-action ${liked?'liked':''}" data-like-id="${item.id}" onclick="toggleLike(event,'${item.id}')">
              ${ICONS.heart}<span class="like-count">${formatCount(item.likeCount||0)}</span>
            </button>
            <button class="mini-action" onclick="shareItem(event,'${item.id}','${item.type}')">
              ${ICONS.share}
            </button>
          </div>
        </div>
      </div>
    </a>`;
}
function skeletonCards(n) {
  return Array.from({length:n}).map(()=>`
    <div class="card">
      <div class="thumb-wrap skel"></div>
    </div>`).join('');
}

/* ============ ভিডিও লেজি-লোড ============
   <video src="..."> থাকলে ব্রাউজার সাথে সাথে সেই ভিডিওর মেটাডেটা ডাউনলোড শুরু করে দেয়,
   পেজে ৩০-৯০টা ভিডিও থাকলে এতগুলো রিকোয়েস্ট একসাথে গেলে সাইট ধীর হয়ে যায়।
   তাই src না দিয়ে data-src রাখা হয়, আর স্ক্রিনের কাছে এলে তবেই আসল src বসানো হয়। */
function initLazyVideos(root) {
  const scope = root || document;
  const vids = scope.querySelectorAll('video[data-src]');
  if (!vids.length) return;
  if (!('IntersectionObserver' in window)) {
    vids.forEach(v => { v.src = v.dataset.src; v.removeAttribute('data-src'); });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const v = entry.target;
      v.src = v.dataset.src;
      v.removeAttribute('data-src');
      io.unobserve(v);
    });
  }, { rootMargin: '300px' });
  vids.forEach(v => io.observe(v));
}
function thumbMediaHTML(item) {
  const isVideo = item.type === 'video';
  if (isVideo && item.thumbUrl) {
    return `<img src="${escapeHtml(item.thumbUrl)}" alt="${escapeHtml(item.caption||'')}" loading="lazy">`;
  }
  if (isVideo) {
    return `<video data-src="${escapeHtml(item.url)}" muted preload="none"></video>`;
  }
  return `<img src="${escapeHtml(item.thumbUrl||item.url)}" alt="${escapeHtml(item.caption||'')}" loading="lazy">`;
}

/* ============ হোম ফিড ============ */
const FEED_PAGE_SIZE = 24;
let feedCache = { all: [], filter: 'all', category: 'all', lastDoc: null, done: false };

async function loadFeed() {
  const feedEl = document.getElementById('feed');
  if (!feedEl) return;
  feedEl.innerHTML = skeletonCards(8);
  feedCache.lastDoc = null;
  feedCache.done = false;
  try {
    const snap = await db.collection('media').orderBy('createdAt', 'desc').limit(FEED_PAGE_SIZE).get();
    feedCache.all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    feedCache.lastDoc = snap.docs[snap.docs.length - 1] || null;
    feedCache.done = snap.docs.length < FEED_PAGE_SIZE;
    renderTrending();
    renderFeed();
  } catch (e) {
    console.error(e);
    feedEl.innerHTML = `<div class="empty-state"><div class="glyph">⚠️</div>এখনো কনটেন্ট লোড করা যায়নি।<br><span style="font-size:12px;color:var(--text-faint)">Firebase কনফিগারেশন ঠিক আছে কিনা দেখুন (js/firebase-config.js)</span></div>`;
  }
}
async function loadMoreFeed(btn) {
  if (feedCache.done || !feedCache.lastDoc) return;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    const snap = await db.collection('media').orderBy('createdAt', 'desc')
      .startAfter(feedCache.lastDoc).limit(FEED_PAGE_SIZE).get();
    const newItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    feedCache.all = feedCache.all.concat(newItems);
    feedCache.lastDoc = snap.docs[snap.docs.length - 1] || feedCache.lastDoc;
    feedCache.done = snap.docs.length < FEED_PAGE_SIZE;
    renderFeed();
  } catch (e) {
    console.error(e);
    showToast('আরও কনটেন্ট লোড করতে সমস্যা হয়েছে');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'আরও দেখুন'; }
  }
}
function renderFeed() {
  const feedEl = document.getElementById('feed');
  if (!feedEl) return;
  let items = feedCache.all;
  if (feedCache.filter !== 'all') items = items.filter(i => i.type === feedCache.filter);
  if (feedCache.category !== 'all') items = items.filter(i => (i.category || 'other') === feedCache.category);
  if (!items.length) {
    feedEl.innerHTML = `<div class="empty-state"><div class="glyph">🎬</div>এই ক্যাটাগরিতে এখনো কিছু আপলোড হয়নি</div>`;
    return;
  }
  feedEl.innerHTML = items.map(mediaCardHTML).join('');
  initLazyVideos(feedEl);
  let moreWrap = document.getElementById('feedLoadMore');
  if (!moreWrap) {
    moreWrap = document.createElement('div');
    moreWrap.id = 'feedLoadMore';
    moreWrap.style.cssText = 'grid-column:1/-1;text-align:center;padding:10px 0 20px';
    feedEl.after(moreWrap);
  }
  moreWrap.innerHTML = (!feedCache.done && feedCache.filter === 'all' && feedCache.category === 'all')
    ? `<button class="btn" style="max-width:220px;margin:0 auto" onclick="loadMoreFeed(this)">আরও দেখুন</button>`
    : '';
}
function setFeedFilter(filter, btn) {
  feedCache.filter = filter;
  document.querySelectorAll('.tabs:not(.chip-row) .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderFeed();
}
function setCategoryFilter(cat, btn) {
  feedCache.category = cat;
  document.querySelectorAll('.chip-row .tab.chip').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderFeed();
}

/* ============ ট্রেন্ডিং (সর্বোচ্চ ভিউ) ব্যানার ============ */
function renderTrending() {
  const wrap = document.getElementById('trendingWrap');
  if (!wrap) return;
  const videos = feedCache.all.filter(i => i.type === 'video');
  if (!videos.length) { wrap.innerHTML = ''; return; }
  const top = videos.slice().sort((a,b) => (b.views||0) - (a.views||0))[0];
  if (!top || !(top.views > 0)) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="trending-label">${ICONS.fire} সবচেয়ে বেশি দেখা ভিডিও</div>
    <a class="trending-card" href="watch.html?id=${top.id}">
      ${top.thumbUrl ? `<img src="${escapeHtml(top.thumbUrl)}" alt="">` : `<video data-src="${escapeHtml(top.url)}" muted preload="none"></video>`}
      <span class="tc-badge">${ICONS.fire} টপ ভিউ</span>
      <div class="tc-play"><div class="tri"></div></div>
      <div class="tc-info">
        <div class="tc-title">${escapeHtml(top.caption || 'শিরোনামহীন')}</div>
        <div class="tc-meta">
          <span>${ICONS.eye.replace('<svg ', '<svg width="13" height="13" ')} ${formatCount(top.views||0)} ভিউ</span>
          <span>${escapeHtml(top.uploaderName || 'ইউজার')}</span>
        </div>
      </div>
    </a>`;
  initLazyVideos(wrap);
}

/* ============ লাইক ============ */
function findItemAnywhere(id) {
  return feedCache.all.find(i => i.id === id)
    || (window._detailItem && window._detailItem.id === id ? window._detailItem : null);
}
async function toggleLike(e, id) {
  e.preventDefault(); e.stopPropagation();
  if (!currentUser) { requireAuth(() => toggleLike(e, id)); return; }
  const item = findItemAnywhere(id);
  const liked = item && item.likedBy && item.likedBy[currentUser.uid];
  const ref = db.collection('media').doc(id);
  try {
    if (liked) {
      await ref.update({
        [`likedBy.${currentUser.uid}`]: firebase.firestore.FieldValue.delete(),
        likeCount: firebase.firestore.FieldValue.increment(-1)
      });
      if (item) { delete item.likedBy[currentUser.uid]; item.likeCount = Math.max(0, (item.likeCount||1) - 1); }
    } else {
      await ref.update({
        [`likedBy.${currentUser.uid}`]: true,
        likeCount: firebase.firestore.FieldValue.increment(1)
      });
      if (item) { item.likedBy = item.likedBy || {}; item.likedBy[currentUser.uid] = true; item.likeCount = (item.likeCount||0) + 1; }
    }
    updateLikeUI(id, item);
  } catch (err) {
    console.error(err);
    showToast('সমস্যা হয়েছে, আবার চেষ্টা করুন');
  }
}
function updateLikeUI(id, item) {
  if (!item) return;
  document.querySelectorAll(`[data-like-id="${id}"]`).forEach(btn => {
    btn.classList.toggle('liked', isLikedByMe(item));
    const cEl = btn.querySelector('.like-count');
    if (cEl) cEl.textContent = formatCount(item.likeCount || 0);
  });
}

/* ============ শেয়ার ============ */
function shareCurrentPage(title) {
  if (navigator.share) {
    navigator.share({ title: title || document.title, url: window.location.href }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(window.location.href);
    showToast('লিংক কপি হয়েছে 🔗');
  }
}
function shareItem(e, id, type) {
  e.preventDefault(); e.stopPropagation();
  const item = findItemAnywhere(id);
  const url = new URL((type === 'video' ? 'watch.html' : 'photo.html') + '?id=' + id, window.location.href).href;
  const title = item?.caption || 'রিলহাব';
  if (navigator.share) {
    navigator.share({ title, url }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(url);
    showToast('লিংক কপি হয়েছে 🔗');
  }
}

/* ============ প্লাস বাটন → আপলোড মোডাল ============ */
function openUploadModal() {
  requireAuth(() => {
    document.getElementById('uploadModal').classList.add('open');
    resetUploadForm();
  });
}
function closeUploadModal() {
  document.getElementById('uploadModal').classList.remove('open');
}
function resetUploadForm() {
  const form = document.getElementById('uploadForm');
  if (form) form.reset();
  document.getElementById('uploadPreviewWrap').innerHTML = '';
  document.getElementById('uploadDrop').classList.remove('hasfile');
  const bar = document.getElementById('uploadProgress');
  bar.classList.remove('show');
  document.querySelector('#uploadProgress .progress-fill').style.width = '0%';
  window._selectedFile = null;
}
function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  window._selectedFile = file;
  document.getElementById('uploadDrop').classList.add('hasfile');
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('uploadPreviewWrap').innerHTML =
      `<div class="upload-preview"><img src="${e.target.result}"></div>`;
  };
  reader.readAsDataURL(file);
}

async function handlePhotoUpload(e) {
  e.preventDefault();
  const file = window._selectedFile;
  const caption = document.getElementById('uploadCaption').value.trim();
  const category = document.getElementById('uploadCategory').value;
  if (!file) { showToast('একটি ফটো সিলেক্ট করুন'); return; }
  if (!caption) { showToast('একটি ক্যাপশন/শিরোনাম লিখুন'); return; }
  if (!IMGBB_API_KEY || IMGBB_API_KEY === 'YOUR_IMGBB_API_KEY') {
    showToast('imgbb API key সেট করা হয়নি — js/firebase-config.js দেখুন');
    return;
  }

  const submitBtn = document.getElementById('uploadSubmitBtn');
  const bar = document.getElementById('uploadProgress');
  const fill = bar.querySelector('.progress-fill');
  bar.classList.add('show');
  fill.style.width = '15%';
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> আপলোড হচ্ছে...';

  try {
    const formData = new FormData();
    formData.append('image', file);
    fill.style.width = '40%';
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    fill.style.width = '75%';
    if (!data.success) throw new Error('imgbb আপলোড ব্যর্থ হয়েছে');

    const url = data.data.url;
    const thumbUrl = data.data.thumb ? data.data.thumb.url : url;

    await db.collection('media').add({
      type: 'photo',
      url, thumbUrl, caption, category,
      uploaderUid: currentUser.uid,
      uploaderName: currentUserData?.displayName || currentUser.email,
      views: 0,
      downloads: 0,
      likeCount: 0,
      likedBy: {},
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    fill.style.width = '100%';
    showToast('ফটো সফলভাবে আপলোড হয়েছে ✅');
    setTimeout(() => {
      closeUploadModal();
      loadFeed();
    }, 500);
  } catch (err) {
    console.error(err);
    showToast('আপলোড ব্যর্থ হয়েছে, আবার চেষ্টা করুন');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'আপলোড করুন';
  }
}
