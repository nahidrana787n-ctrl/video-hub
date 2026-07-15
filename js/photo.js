const photoId = new URLSearchParams(window.location.search).get('id');
let currentPhotoData = null;
let _photoViewCounted = false;

async function loadPhoto() {
  if (!photoId) { window.location.href = 'index.html'; return; }
  try {
    const doc = await db.collection('media').doc(photoId).get();
    if (!doc.exists || doc.data().type !== 'photo') {
      document.getElementById('photoInfo').innerHTML = `<div class="empty-state"><div class="glyph">😕</div>ফটোটি খুঁজে পাওয়া যায়নি</div>`;
      return;
    }
    currentPhotoData = { id: doc.id, ...doc.data() };
    window._detailItem = currentPhotoData;
    renderPhoto();
    loadSuggestions();
    countPhotoView();
  } catch (e) { console.error(e); }
}

function countPhotoView() {
  if (_photoViewCounted) return;
  _photoViewCounted = true;
  db.collection('media').doc(photoId).update({
    views: firebase.firestore.FieldValue.increment(1)
  }).catch(()=>{});
  currentPhotoData.views = (currentPhotoData.views || 0) + 1;
}

function renderPhoto() {
  const p = currentPhotoData;
  document.getElementById('photoImg').src = p.url;
  document.getElementById('photoImg').alt = p.caption || '';
  const liked = isLikedByMe(p);

  document.getElementById('photoInfo').innerHTML = `
    <div class="watch-title">${escapeHtml(p.caption || 'শিরোনামহীন')}</div>
    <div style="font-size:12.5px;color:var(--text-faint);margin-bottom:10px;display:flex;align-items:center;gap:5px">
      ${ICONS.eye.replace('<svg ', '<svg width="13" height="13" ')} ${formatCount(p.views||0)} বার দেখা হয়েছে
    </div>
    <div class="watch-meta-row">
      <div class="uploader">
        <div class="avatar">${(p.uploaderName||'?').trim()[0]?.toUpperCase()||'?'}</div>
        <div>${escapeHtml(p.uploaderName||'ইউজার')}<br><span style="font-size:11.5px;color:var(--text-faint)">${timeAgo(p.createdAt)}</span></div>
      </div>
      <div class="action-row">
        <button class="action-btn ${liked?'liked':''}" data-like-id="${p.id}" onclick="toggleLike(event,'${p.id}')">
          ${ICONS.heart}<span class="like-count">${formatCount(p.likeCount||0)}</span>
        </button>
        <button class="action-btn" onclick="downloadPhoto('${escapeHtml(p.url)}','${escapeHtml(p.caption||'photo')}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          ডাউনলোড
        </button>
        <button class="action-btn" onclick="shareItem(event,'${p.id}','photo')">
          ${ICONS.share} শেয়ার
        </button>
      </div>
    </div>
  `;

  const gate = document.getElementById('photoGate');
  gate.style.display = currentUser ? 'none' : 'flex';
}

document.addEventListener('authReady', () => {
  if (!currentPhotoData) return;
  document.getElementById('photoGate').style.display = currentUser ? 'none' : 'flex';
  renderPhoto();
});

function downloadPhoto(url, name) {
  if (!currentUser) { requireAuth(()=>downloadPhoto(url,name)); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  db.collection('media').doc(photoId).update({
    downloads: firebase.firestore.FieldValue.increment(1)
  }).catch(()=>{});
}

async function loadSuggestions() {
  const listEl = document.getElementById('suggestList');
  try {
    const snap = await db.collection('media').where('type','==','photo').orderBy('createdAt','desc').limit(30).get();
    let items = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(i => i.id !== photoId);
    const sameCat = items.filter(i => i.category === currentPhotoData.category);
    const rest = items.filter(i => i.category !== currentPhotoData.category);
    items = [...sameCat, ...rest].slice(0, 20);
    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state">আর কোনো ফটো নেই</div>`;
      return;
    }
    listEl.innerHTML = items.map(i => `
      <a class="card" href="photo.html?id=${i.id}">
        <div class="thumb-wrap">
          <img src="${escapeHtml(i.thumbUrl||i.url)}" loading="lazy">
          <span class="badge photo">ফটো</span>
          <span class="badge views">${ICONS.eye.replace('<svg ', '<svg width="11" height="11" ')}${formatCount(i.views||0)}</span>
          <div class="card-overlay-body">
            <div class="card-title">${escapeHtml(i.caption||'শিরোনামহীন')}</div>
            <div class="card-meta"><span>${escapeHtml(i.uploaderName||'ইউজার')}</span></div>
          </div>
        </div>
      </a>`).join('');
  } catch (e) { console.error(e); }
}

document.addEventListener('DOMContentLoaded', loadPhoto);
