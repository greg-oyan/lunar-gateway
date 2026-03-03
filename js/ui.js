export function renderList(requirements, container, onSelect) {
  container.innerHTML = '';

  if (!requirements.length) {
    container.innerHTML = `<p style="color:#a8b0c0">No matches.</p>`;
    return;
  }

  for (const req of requirements) {
    const div = document.createElement('div');
    div.className = 'req-item';
    div.innerHTML = `
      <div class="req-id">${escapeHtml(req.id)}</div>
      <div class="req-title">${escapeHtml(req.title)}</div>
    `;
    div.addEventListener('click', () => onSelect(req));
    container.appendChild(div);
  }
}

export function renderDetail(req, container, note, onNoteChange) {
  container.innerHTML = `
    <h2 style="margin-top:0">${escapeHtml(req.id)}</h2>
    <p style="color:#a8b0c0; margin-top:-8px">${escapeHtml(req.domain)} • ${escapeHtml(req.priority)}</p>
    <h3 style="margin-bottom:6px">${escapeHtml(req.title)}</h3>
    <p style="line-height:1.4">${escapeHtml(req.text)}</p>

    <hr style="border:0;border-top:1px solid #2a3140;margin:18px 0" />

    <h3 style="margin:0 0 8px 0">Analyst notes (local)</h3>
    <textarea id="noteBox" style="width:100%;min-height:140px;background:#0c0f14;color:#eaeaea;border:1px solid #2a3140;border-radius:10px;padding:10px;">${escapeHtml(note || '')}</textarea>
  `;

  const box = container.querySelector('#noteBox');
  box.addEventListener('input', (e) => onNoteChange(e.target.value));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}