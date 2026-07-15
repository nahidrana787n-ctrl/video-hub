const videoId = new URLSearchParams(window.location.search).get('id');
let currentVideoData = null;
let _viewCounted = false;

async function loadVideo() {
  if (!videoId) { window.location.href = 'index.html'; return; }
  try {
    const doc = await db.collection('media').doc(videoId).get();
    if (!doc.exists || doc.data().type !== 'video') {
      document.getElementById('watchInfo').innerHTML = `<div class="empty-state"><div class="glyph">😕</div>ভিডিওটি খুঁজে পাওয়া যায়নি</div>`;
      return;
    }
    currentVideoData = { id: doc.id, ...doc.data() };
    window._detailItem = currentVideoData;
    renderVideo();
    loadSuggestions();
    countView();
  } catch (e) {
    console.error(e);
  }
}

function countView() {
  if (_viewCounted) return;
  _viewCounted = true;
  db.collection('media').doc(videoId).update({
    views: firebase.firestore.FieldValue.increment(1)
  }).catch(()=>{});
  currentVideoData.views = (currentVideoData.views || 0) + 1;
}

function renderVideo() {
  const v = currentVideoData;
  const player = document.getElementById('videoPlayer');
  player.src = v.url;
  player.poster = v.thumbUrl || '';
  const liked = isLikedByMe(v);

  document.getElementById('watchInfo').innerHTML = `
    <div class="watch-title">${escapeHtml(v.caption || 'শিরোনামহীন')}</div>
    <div style="font-size:12.5px;color:var(--text-faint);margin-bottom:10px;display:flex;align-items:center;gap:5px">
      ${ICONS.eye.replace('<svg ', '<svg width="13" height="13" ')} ${formatCount(v.views||0)} বার দেখা হয়েছে
    </div>
    <div class="watch-meta-row">
      <div class="uploader">
        <div class="avatar">${(v.uploaderName||'?').trim()[0]?.toUpperCase()||'?'}</div>
        <div>${escapeHtml(v.uploaderName||'ইউজার')}<br><span style="font-size:11.5px;color:var(--text-faint)">${timeAgo(v.createdAt)}</span></div>
      </div>
      <div class="action-row">
        <button class="action-btn ${liked?'liked':''}" data-like-id="${v.id}" onclick="toggleLike(event,'${v.id}')">
          ${ICONS.heart}<span class="like-count">${formatCount(v.likeCount||0)}</span>
        </button>
        <button class="action-btn" onclick="downloadMedia('${escapeHtml(v.url)}','${escapeHtml(v.caption||'video')}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          ডাউনলোড
        </button>
        <button class="action-btn" onclick="shareItem(event,'${v.id}','video')">
          ${ICONS.share} শেয়ার
        </button>
        <button class="action-btn" onclick="requestFullscreen()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M3 16v3a2 2 0 002 2h3"/></svg>
          ফুলস্ক্রিন
        </button>
      </div>
    </div>
  `;

  // লগইন গেট
  const gate = document.getElementById('videoGate');
  if (!currentUser) {
    document.getElementById('videoPlayer').controls = false;
    gate.style.display = 'flex';
  } else {
    gate.style.display = 'none';
  }
}

document.addEventListener('authReady', () => {
  if (!currentVideoData) return;
  const gate = document.getElementById('videoGate');
  const player = document.getElementById('videoPlayer');
  if (currentUser) { gate.style.display = 'none'; player.controls = true; }
  else { gate.style.display = 'flex'; player.controls = false; player.pause(); }
  renderVideo();
});

function requestFullscreen() {
  const player = document.getElementById('videoPlayer');
  if (!currentUser) { requireAuth(()=>{}); return; }
  if (player.requestFullscreen) player.requestFullscreen();
  else if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
}

function downloadMedia(url, name) {
  if (!currentUser) { requireAuth(()=>downloadMedia(url,name)); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  db.collection('media').doc(videoId).update({
    downloads: firebase.firestore.FieldValue.increment(1)
  }).catch(()=>{});
}

async function loadSuggestions() {
  const listEl = document.getElementById('suggestList');
  try {
    const snap = await db.collection('media').where('type','==','video').orderBy('createdAt','desc').limit(30).get();
    let items = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(i => i.id !== videoId);
    // একই ক্যাটাগরির ভিডিও আগে দেখাও, তারপর বাকিগুলো
    const sameCat = items.filter(i => i.category === currentVideoData.category);
    const rest = items.filter(i => i.category !== currentVideoData.category);
    items = [...sameCat, ...rest].slice(0, 20);
    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state">আর কোনো ভিডিও নেই</div>`;
      return;
    }
    listEl.innerHTML = items.map(i => `
      <a class="card" href="watch.html?id=${i.id}">
        <div class="thumb-wrap">
          ${thumbMediaHTML(i)}
          <span class="badge video">ভিডিও</span>
          <span class="badge views">${ICONS.eye.replace('<svg ', '<svg width="11" height="11" ')}${formatCount(i.views||0)}</span>
          <div class="card-overlay-body">
            <div class="card-title">${escapeHtml(i.caption||'শিরোনামহীন')}</div>
            <div class="card-meta"><span>${escapeHtml(i.uploaderName||'ইউজার')}</span></div>
          </div>
        </div>
      </a>`).join('');
    initLazyVideos(listEl);
  } catch (e) { console.error(e); }
}

document.addEventListener('DOMContentLoaded', loadVideo);
